package main

import (
    "flag"
    "log"
    "net"

    "os"
    "os/signal"
    "strings"
    "syscall"

    "jesseboth/fdt/src/util"
    "jesseboth/fdt/src/game"
)

const hostname = "0.0.0.0"            // Address to listen on (0.0.0.0 = all interfaces)
const port = "9999"                   // UDP Port number to listen on
const service = hostname + ":" + port // Combined hostname+port

func main() {
    var gameSTR string;
    var splitTypeSTR string;

    flag.StringVar(&gameSTR, "game", "FM", "Specify an abreviated game ie: FM, FH5")
    jsonPTR := flag.Bool("j", true, "Enables JSON HTTP server on port 8888")
    flag.StringVar(&splitTypeSTR, "split", "car", "car(overall)/class(overall)/session based splits")
    debugModePTR := flag.Bool("d", false, "Enables extra debug information if set")
    flag.Parse()

    jsonEnabled := *jsonPTR

    if game.Forza(gameSTR) {
        game.ForzaSetSplit(splitTypeSTR);
    }

    debugMode := *debugModePTR

    SetupCloseHandler() // handle CTRL+C

    if debugMode {
        log.Println("Debug mode enabled")
    }

    var formatFile = "packets/" + gameSTR + "_packetformat.dat"

    // Load lines from packet format file
    lines, err := util.ReadLines(formatFile)
    if err != nil {
        log.Fatalf("Error reading format file: %s", err)
    }

    // Process format file into array of util.Telemetry structs
    startOffset := 0
    endOffset := 0
    dataLength := 0
    totalLength := 0
    var telemArray []util.Telemetry

    for i, line := range lines {
        dataClean := strings.Split(line, ";")
        dataFormat := strings.Split(dataClean[0], " ")
        dataType := dataFormat[0]
        dataName := dataFormat[1]

        switch dataType {
        case "s32":
            dataLength = 4
            endOffset = endOffset + dataLength
            startOffset = endOffset - dataLength
            totalLength = totalLength + dataLength
            telemItem := util.Telemetry{i, dataName, dataType, startOffset, endOffset}
            telemArray = append(telemArray, telemItem)
        case "u32":
            dataLength = 4
            endOffset = endOffset + dataLength
            startOffset = endOffset - dataLength
            totalLength = totalLength + dataLength
            telemItem := util.Telemetry{i, dataName, dataType, startOffset, endOffset}
            telemArray = append(telemArray, telemItem)
        case "f32":
            dataLength = 4
            endOffset = endOffset + dataLength
            startOffset = endOffset - dataLength
            totalLength = totalLength + dataLength
            telemItem := util.Telemetry{i, dataName, dataType, startOffset, endOffset}
            telemArray = append(telemArray, telemItem)
        case "u16":
            dataLength = 2
            endOffset = endOffset + dataLength
            startOffset = endOffset - dataLength
            totalLength = totalLength + dataLength
            telemItem := util.Telemetry{i, dataName, dataType, startOffset, endOffset}
            telemArray = append(telemArray, telemItem)
        case "u8":
            dataLength = 1
            endOffset = endOffset + dataLength
            startOffset = endOffset - dataLength
            totalLength = totalLength + dataLength
            telemItem := util.Telemetry{i, dataName, dataType, startOffset, endOffset}
            telemArray = append(telemArray, telemItem)
        case "s8":
            dataLength = 1
            endOffset = endOffset + dataLength
            startOffset = endOffset - dataLength
            totalLength = totalLength + dataLength
            telemItem := util.Telemetry{i, dataName, dataType, startOffset, endOffset}
            telemArray = append(telemArray, telemItem)
        case "hzn":
            dataLength = 12
            endOffset = endOffset + dataLength
            startOffset = endOffset - dataLength
            totalLength = totalLength + dataLength
            telemItem := util.Telemetry{i, dataName, dataType, startOffset, endOffset}
            telemArray = append(telemArray, telemItem)
        default:
            log.Fatalf("Error: Unknown data type in %s \n", formatFile)
        }
        if debugMode {
            log.Printf("Processed %s line %d: %s (%s),  Byte offset: %d:%d \n", formatFile, i, dataName, dataType, startOffset, endOffset)
        }
    }

    if debugMode {
        log.Printf("Logging entire telemArray: \n%v", telemArray)
        log.Printf("Proccessed %d util.Telemetry types OK!", len(telemArray))
    }


    if jsonEnabled {
        go util.ServeJson()
    }

    // Setup UDP listener
    udpAddr, err := net.ResolveUDPAddr("udp4", service)
    if err != nil {
        log.Fatal(err)
    }

    listener, err := net.ListenUDP("udp", udpAddr)
    if(err != nil){
        log.Fatal(err)
    }
    defer listener.Close()

    if(debugMode){
        log.Printf("Forza data out server listening on %s:%s, waiting for Forza data...\n", util.GetOutboundIP(), port)
    }


    if game.Forza(gameSTR) {
        for {
            game.ForzaReadData(listener, telemArray, totalLength, debugMode)
        }
    }
}

// SetupCloseHandler performs some clean up on exit (CTRL+C)
func SetupCloseHandler() {
    c := make(chan os.Signal, 2)
    signal.Notify(c, os.Interrupt, syscall.SIGTERM)
    go func() {
        <-c
        os.Exit(0)
    }()
}



