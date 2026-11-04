package game

import (
    "encoding/binary"
    "encoding/json"
    "log"
    "math"
    "net"

    "jesseboth/fdt/src/util"
)

func DirtLoop(game string, conn *net.UDPConn, telemArray []util.Telemetry, totalLength int, debug bool) {
    log.Println("Starting Telemetry:", DirtGame(game))
    recorder := NewRecorder(game, debug)
    for {
        DirtReadData(conn, telemArray, totalLength, recorder, debug)
    }
}

func Dirt(game string) bool {
    switch game {
        case "DR2":
        case "DR":
        case "Dirt5":
        case "Dirt4":
        case "Dirt3":
        default:
            return false
        }
    return true;
}

func DirtGame(game string) string {
    var gameSTR string = "";
    switch game {
        case "DR2":
            gameSTR = "Dirt Rally 2.0"
        case "DR":
            gameSTR = "Dirt Rally"
        case "Dirt5":
            gameSTR = "Dirt 5"
        case "Dirt4":
            gameSTR = "Dirt 4"
        case "Dirt3":
            gameSTR = "Dirt 3"
        default:
            return "Unknown"
        }
    return gameSTR;
}

func DirtReadData(conn *net.UDPConn, telemArray []util.Telemetry, totalLength int, recorder *Recorder, debug bool) {
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

    // Add the IsRaceOn field
    combinedMap["IsRaceOn"] = true

    progress := float32(-1)
    if f32map["StageLength"] > 0 {
        progress = f32map["StageProgress"]
    }
    trackID := stageID(float64(f32map["StageLength"]))
    combinedMap["TrackId"] = trackID
    recorder.Update(Frame{
        Timer:    f32map["CurrentLap"],
        LastLap:  f32map["LastLap"],
        HasLastLap: true,
        Progress: progress,
        TrackID:  trackID,
        Sample:   dirtSample(f32map),
    })

    // RPM values are sent divided by 10. Fields missing from the packet format are skipped.
    for _, name := range []string{"CurrentEngineRpm", "EngineMaxRpm", "EngineIdleRpm"} {
        if v, ok := combinedMap[name].(float32); ok {
            combinedMap[name] = v * 10
        }
    }

    combinedMap["GearNeutral"] = 0
    combinedMap["GearReverse"] =  -1

    // Lap number is sent starting at 0
    if v, ok := combinedMap["LapNumber"].(float32); ok {
        combinedMap["LapNumber"] = v + 1
    }

    // Fuel? = capacity / level

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



// dirtSample makes a run sample from the DiRT Rally packet. The game gives G forces directly.
func dirtSample(f32map map[string]float32) util.TelemetrySample {
    sample := util.TelemetrySample{
        Brake:  roundTo(f32map["Brake"], 3),
        Accel:  roundTo(f32map["Accel"], 3),
        AccelX: roundTo(f32map["GForceLat"], 2),
        AccelY: roundTo(f32map["GForceLon"], 2),
        Speed:  roundTo(mph(f32map["Speed"]), 2),
        PosX:   f32map["PositionX"],
        PosY:   f32map["PositionZ"],
        PosZ:   f32map["PositionY"],
        Steer:  roundTo(f32map["Steer"], 2),
        Clutch: roundTo(f32map["Clutch"], 3),
        Rpm:    float32(math.Round(float64(f32map["CurrentEngineRpm"] * 10))),
        Gear:   int32(f32map["Gear"]),
    }
    for i, wheel := range [4]string{"FL", "FR", "RL", "RR"} {
        sample.WheelSpeed[i] = roundTo(absFloat32(mph(f32map["WheelSpeed"+wheel])), 1)
    }
    return sample
}
