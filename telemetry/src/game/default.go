package game

import (
    "encoding/binary"
    "encoding/json"
    "log"
    "math"
    "net"

    "jesseboth/fdt/src/util"
)

func DefaultLoop(game string, conn *net.UDPConn, telemArray []util.Telemetry, totalLength int, debug bool) {
    log.Println("Starting Telemetry:", DefaultGame(game))
    recorder := NewRecorder(game, debug)
    for {
        default_readData(conn, telemArray, totalLength, recorder, debug)
    }
}

func Default(game string) bool {
    return true
}

func DefaultGame(game string) string {
    switch game {
    case "DR2":
        return "Dirt Rally 2.0"
    case "WRC":
        return "EA WRC"
    default:
        return game + " Generic"
    }
}

func default_readData(conn *net.UDPConn, telemArray []util.Telemetry, totalLength int, recorder *Recorder, debug bool) {
    buffer := make([]byte, 1500)

    n, addr, err := conn.ReadFromUDP(buffer)

    if debug {
        log.Println("Received data length:", n)
    }

    if err != nil {
        log.Fatal("Error reading UDP data:", err, addr)
    } else if n < totalLength {
        if util.WrongData <= 5 {
            util.WrongData++
        } else {
            util.SetJson("")
        }
        return
    }

    util.WrongData = 0
    if debug {
        log.Println("UDP client connected:", addr)
    }

    // Maps for all types
    s32map := make(map[string]int32)
    u32map := make(map[string]uint32)
    f32map := make(map[string]float32)
    u16map := make(map[string]uint16)
    u8map := make(map[string]uint8)
    s8map := make(map[string]int8)
    u64map := make(map[string]uint64)
    f64map := make(map[string]float64)
    boolmap := make(map[string]bool)

    for i, T := range telemArray {
        data := buffer[:n][T.StartOffset:T.EndOffset]
        if debug {
            log.Printf("Data chunk %d: %v (%s) (%s)", i, data, T.Name, T.DataType)
        }

        switch T.DataType {
        case "s32":
            s32map[T.Name] = int32(binary.LittleEndian.Uint32(data))
        case "u32":
            u32map[T.Name] = binary.LittleEndian.Uint32(data)
        case "f32":
            val := util.Float32frombytes(data)
            f32map[T.Name] = val

        case "u16":
            u16map[T.Name] = binary.LittleEndian.Uint16(data)
        case "u8":
            u8map[T.Name] = uint8(data[0])
        case "s8":
            s8map[T.Name] = int8(data[0])
        case "u64":
            u64map[T.Name] = binary.LittleEndian.Uint64(data)
        case "f64":
            f64map[T.Name] = util.Float64frombytes(data)
        case "bool":
            boolmap[T.Name] = data[0] != 0
        }
    }

    // Combine all maps into a single map
    combinedMap := make(map[string]interface{})
    for k, v := range s32map {
        combinedMap[k] = v
    }
    for k, v := range u32map {
        combinedMap[k] = v
    }
    for k, v := range f32map {
        combinedMap[k] = v
    }
    for k, v := range u16map {
        combinedMap[k] = v
    }
    for k, v := range u8map {
        combinedMap[k] = v
    }
    for k, v := range s8map {
        combinedMap[k] = v
    }
    for k, v := range u64map {
        combinedMap[k] = v
    }
    for k, v := range f64map {
        combinedMap[k] = v
    }
    for k, v := range boolmap {
        combinedMap[k] = v
    }

    // A packet with a junk timer (DiRT Rally 2.0 at "Return to service area") is not shown or recorded
    if timer, ok := f32map["CurrentLap"]; ok && !validTimer(timer) {
        return
    }

    // Add the IsRaceOn field
    combinedMap["IsRaceOn"] = true

    // Games without a run timer cannot record runs
    if timer, ok := f32map["CurrentLap"]; ok {
        progress := float32(-1)
        var trackID int32
        if length, ok := f64map["StageLength"]; ok {
            if length > 0 {
                progress = float32(f64map["Odometer"] / length)
            }
            trackID = stageID(length)
            combinedMap["TrackId"] = trackID
        }
        recorder.Update(Frame{
            Timer:    timer,
            Progress: progress,
            TrackID:  trackID,
            Sample:   defaultSample(f32map, u8map),
        })
    }

    finalJSON, err := json.Marshal(combinedMap)
    if err != nil {
        log.Printf("Error marshalling combined JSON: %v", err)
        return
    }

    if debug {
        log.Println(string(finalJSON))
    }
    util.SetJson(string(finalJSON))
}



// defaultSample makes a run sample from a generic packet, such as EA WRC.
// EA WRC gives the acceleration in world axes; the car direction vectors turn it into G forces.
func defaultSample(f32map map[string]float32, u8map map[string]uint8) util.TelemetrySample {
    ax, ay, az := f32map["AccelerationX"], f32map["AccelerationY"], f32map["AccelerationZ"]
    left := ax*f32map["LeftDirectionX"] + ay*f32map["LeftDirectionY"] + az*f32map["LeftDirectionZ"]
    forward := ax*f32map["ForwardDirectionX"] + ay*f32map["ForwardDirectionY"] + az*f32map["ForwardDirectionZ"]

    gear := int32(u8map["Gear"])
    if gear == int32(u8map["GearReverse"]) {
        gear = -1
    } else if gear == int32(u8map["GearNeutral"]) {
        gear = 0
    }

    sample := util.TelemetrySample{
        Brake:  roundTo(f32map["Brake"], 3),
        Accel:  roundTo(f32map["Accel"], 3),
        AccelX: roundTo(-left/gravity, 2),
        AccelY: roundTo(forward/gravity, 2),
        Speed:  roundTo(mph(f32map["Speed"]), 2),
        PosX:   f32map["PositionX"],
        PosY:   f32map["PositionZ"],
        PosZ:   f32map["PositionY"],
        Steer:  roundTo(f32map["Steer"], 2),
        Clutch: roundTo(f32map["Clutch"], 3),
        Rpm:    float32(math.Round(float64(f32map["CurrentEngineRpm"]))),
        Gear:   gear,
    }
    for i, wheel := range [4]string{"FL", "FR", "BL", "BR"} {
        sample.WheelSpeed[i] = roundTo(absFloat32(mph(f32map["CPForwardSpeed"+wheel])), 1)
    }
    return sample
}
