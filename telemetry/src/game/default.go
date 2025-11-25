package game

import (
    "encoding/binary"
    "encoding/json"
    "fmt"
    "log"
    "net"

    "jesseboth/fdt/src/util"
)

func DefaultLoop(game string, conn *net.UDPConn, telemArray []util.Telemetry, totalLength int, debug bool) {
    fmt.Println("Starting Telemetry:", DefaultGame(game))
    for {
        default_readData(conn, telemArray, totalLength, debug)
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

func default_readData(conn *net.UDPConn, telemArray []util.Telemetry, totalLength int, debug bool) {
    buffer := make([]byte, 1500)

    n, addr, err := conn.ReadFromUDP(buffer)

    log.Println("Received data length:", n)

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

    finalJSON, err := json.Marshal(combinedMap)
    if err != nil {
        log.Fatalf("Error marshalling combined JSON: %v", err)
    }

    if debug {
        log.Println(string(finalJSON))
    }
    util.SetJson(string(finalJSON))
}
