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

func main() {
    var gameSTR string
    var splitTypeSTR string
    var portSTR string

    flag.StringVar(&gameSTR, "game", "FM", "Specify an abbreviated game ie: FM, FH5")
    flag.StringVar(&splitTypeSTR, "split", "car", "car(overall)/class(overall)/session based splits")
    flag.StringVar(&portSTR, "port", "9999", "UDP port number to listen on")
    debugModePTR := flag.Bool("d", false, "Enables extra debug information if set")
    flag.Parse()

    service := hostname + ":" + portSTR // Combined hostname+port

    if game.Forza(gameSTR) {
        game.ForzaSetSplit(splitTypeSTR)
    }

    debugMode := *debugModePTR

    setupCloseHandler() // handle CTRL+C

    if debugMode {
        log.Println("Debug mode enabled")
    }

    var formatFile = "packets/" + gameSTR + "_packetformat.dat"

    // Load lines from packet format file
    var lines []string
    var telemArray []util.Telemetry
    var totalLength int
    var err error

    lines, err = util.ReadLines(formatFile)
    if err != nil {
        log.Fatalf("Error reading format file: %s", err)
    }

    // Process format file into array of util.Telemetry structs
    startOffset := 0
    endOffset := 0

    for i, line := range lines {
        dataClean := strings.Split(line, ";")
        dataFormat := strings.Split(dataClean[0], " ")
        
        // check if dataFormat has at least 2 elements if not, skip this line
        if len(dataFormat) < 2 {
            if debugMode {
                log.Printf("Warning: Skipping malformed line %d in %s: %s", i, formatFile, line)
            }
            continue
        } else if (strings.HasPrefix(dataFormat[0], "//")) {
            // make sure line is not a comment
            if debugMode {
                log.Printf("Skipping comment line %d in %s", i, formatFile)
            }
            continue
        }
        
        dataType := dataFormat[0]
        dataName := dataFormat[1]

        if debugMode {
            log.Printf("DataType: %s, DataName: %s", dataType, dataName)
        }

        var dataLength int

        switch dataType {
        case "s32", "u32", "f32":
            dataLength = 4
        case "u16":
            dataLength = 2
        case "u8", "s8", "bool":
            dataLength = 1
        case "u64", "f64":
            dataLength = 8
        case "hzn":
            dataLength = 12
        default:
            log.Fatalf("Error: Unknown data type '%s' in %s \n", dataType, formatFile)
        }

        // Compute offsets and append telemetry item
        endOffset += dataLength
        startOffset = endOffset - dataLength
        totalLength += dataLength
        telemItem := util.Telemetry{i, dataName, dataType, startOffset, endOffset}
        telemArray = append(telemArray, telemItem)

        if debugMode {
            log.Printf("Processed %s line %d: %s (%s),  Byte offset: %d:%d \n",
                formatFile, i, dataName, dataType, startOffset, endOffset)
        }
    }

    if debugMode {
        log.Printf("Logging entire telemArray: \n%v", telemArray)
        log.Printf("Processed %d util.Telemetry types OK!", len(telemArray))
    }

    go util.ServeJson()

    // Setup UDP listener
    udpAddr, err := net.ResolveUDPAddr("udp4", service)
    if err != nil {
        log.Fatal(err)
    }

    listener, err := net.ListenUDP("udp", udpAddr)
    if err != nil {
        log.Fatal(err)
    }
    defer listener.Close()

    if debugMode {
        log.Printf("Telemetry data out server listening on %s:%s, waiting for data...\n", util.GetOutboundIP(), portSTR)
        log.Printf("Length of telemetry packet: %d bytes\n", totalLength)
    } else {
        log.Printf("Reading data on port %s\n", portSTR)
    }


    if game.Forza(gameSTR) {
        go game.ForzaLoop(gameSTR, listener, telemArray, totalLength, debugMode)
    } else if game.Dirt(gameSTR) {
        go game.DirtLoop(gameSTR, listener, telemArray, totalLength, debugMode)
    } else {
        go game.DefaultLoop(gameSTR, listener, telemArray, totalLength, debugMode)
    }

    for {}
}

func setupCloseHandler() {
    c := make(chan os.Signal, 2)
    signal.Notify(c, os.Interrupt, syscall.SIGTERM)
    go func() {
        <-c
        os.Exit(0)
    }()
}
