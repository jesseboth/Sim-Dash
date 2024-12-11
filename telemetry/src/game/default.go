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
    return true;
}

func DefaultGame(game string) string {
    var gameSTR string = "";
    switch game {
        case "DR2":
            gameSTR = "Dirt Rally 2.0"
        default:
            return "Generic Telemetry" // still requires packet data
        
        }
    return gameSTR;
}

func default_readData(conn *net.UDPConn, telemArray []util.Telemetry, totalLength int, debug bool) {
    buffer := make([]byte, 1500)

    n, addr, err := conn.ReadFromUDP(buffer)
    if err != nil {
        log.Fatal("Error reading UDP data:", err, addr)
    } else if n < totalLength {
        if(wrongData <= 5) {
            wrongData++;
        } else {
            util.SetJson("")
        }
        return
    }

    wrongData = 0;
    if debug {
        log.Println("UDP client connected:", addr)
    }

    s32map := make(map[string]uint32)
    u32map := make(map[string]uint32)
    f32map := make(map[string]float32)
    u16map := make(map[string]uint16)
    u8map := make(map[string]uint8)
    s8map := make(map[string]int8)

    for i, T := range telemArray {
        data := buffer[:n][T.StartOffset:T.EndOffset]

        if debug {
            log.Printf("Data chunk %d: %v (%s) (%s)", i, data, T.Name, T.DataType)
        }

        switch T.DataType {
        case "s32":
            s32map[T.Name] = binary.LittleEndian.Uint32(data)
        case "u32":
            u32map[T.Name] = binary.LittleEndian.Uint32(data)
        case "f32":
            dataFloated := util.Float32frombytes(data)
            f32map[T.Name] = dataFloated
        case "u16":
            u16map[T.Name] = binary.LittleEndian.Uint16(data)
        case "u8":
            u8map[T.Name] = uint8(data[0])
        case "s8":
            s8map[T.Name] = int8(data[0])
        }
    }

    if true {
        // Create a single map to hold all combined data
        combinedMap := make(map[string]interface{})

        // Add each original map's contents to the combined map
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

        // Marshal the combined map into a single JSON object
        finalJSON, err := json.Marshal(combinedMap)
        if err != nil {
            log.Fatalf("Error marshalling combined JSON: %v", err)
        }

        util.SetJson(fmt.Sprintf("%s", finalJSON))
    }
}