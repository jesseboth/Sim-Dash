package main

import (
    "bufio"
    "encoding/binary"
    "flag"
    "fmt"
    "log"
    "math"
    "net"

    "os"
    "os/signal"
    "strings"
    "syscall"
    "strconv"

    "encoding/json"
    "io/ioutil"
    "path/filepath"
)

const hostname = "0.0.0.0"            // Address to listen on (0.0.0.0 = all interfaces)
const port = "9999"                   // UDP Port number to listen on
const service = hostname + ":" + port // Combined hostname+port

var jsonData string // Stores the JSON data to be sent out via the web server if enabled
var motorsport bool = false

// Telemetry struct represents a piece of telemetry as defined in the Forza data format (see the .dat files)
type Telemetry struct {
    position    int
    name        string
    dataType    string
    startOffset int
    endOffset   int
}

type CarDescription struct {
    CarNumber     int
    TrackNumber   int
    CarClass	  int
}

type TimingData struct {
    Car           CarDescription
    TimingSplits  []float32 // Current lap splits
    BestSplits    []float32 // Best splits for comparison
    SessionSplits []float32 // Best splits for the current session
    BestCarTrack  CarDescription       // Track number for the best car for the specific track
    BestCarTrackSplits []float32 // Time for the best car for the specific track
    startMeters   float32
}

type SplitType int
const (
	Unknown SplitType = iota // iota starts at 0 and increments
    ClassSpecific
	CarSpecific
	Session
)

var timingData = TimingData{
    Car: CarDescription{
        CarNumber:   -1, // Default value for CarNumber
        TrackNumber: -1, // Default value for TrackNumber
        CarClass:    -1, // Default value for CarClass
    },
    TimingSplits:  []float32{}, // Initializing empty slices
    BestSplits:    []float32{}, // Initializing empty slices
    SessionSplits: []float32{}, // Initializing empty slices
    BestCarTrack: CarDescription{
        CarNumber:   -1, // Default value for CarNumber
        TrackNumber: -1, // Default value for TrackNumber
        CarClass:    -1, // Default value for CarClass
    },
    BestCarTrackSplits: []float32{},
    startMeters:   -1,           // Default value (already the zero value, so optional)
}

const splitDistance float32 = 12.0  // Distance per split, adjust as necessary
const maxFloat = 9999999999.0
var wrongData int = 0;
var splitType SplitType = Unknown;

// readForzaData processes recieved UDP packets
func readForzaData(conn *net.UDPConn, telemArray []Telemetry, totalLength int) {
    buffer := make([]byte, 1500)

    n, addr, err := conn.ReadFromUDP(buffer)
    if err != nil {
        log.Fatal("Error reading UDP data:", err, addr)
    } else if n < totalLength {
        if(wrongData <= 5) {
            wrongData++;
        } else {
            jsonData = "";
        }
        return
    }

    wrongData = 0;
    if isFlagPassed("d") == true {
        log.Println("UDP client connected:", addr)
    }

    s32map := make(map[string]uint32)
    u32map := make(map[string]uint32)
    f32map := make(map[string]float32)
    u16map := make(map[string]uint16)
    u8map := make(map[string]uint8)
    s8map := make(map[string]int8)

    for i, T := range telemArray {
        data := buffer[:n][T.startOffset:T.endOffset]

        if isFlagPassed("d") == true {
            log.Printf("Data chunk %d: %v (%s) (%s)", i, data, T.name, T.dataType)
        }

        switch T.dataType {
        case "s32":
            s32map[T.name] = binary.LittleEndian.Uint32(data)
        case "u32":
            u32map[T.name] = binary.LittleEndian.Uint32(data)
        case "f32":
            dataFloated := Float32frombytes(data)
            f32map[T.name] = dataFloated
        case "u16":
            u16map[T.name] = binary.LittleEndian.Uint16(data)
        case "u8":
            u8map[T.name] = uint8(data[0])
        case "s8":
            s8map[T.name] = int8(data[0])
        }
    }

    // Dont print / log / do anything if RPM is zero
    // This happens if the game is paused or you rewind
    // There is a bug with FH4 where it will continue to send data when in certain menus
    if !motorsport && f32map["CurrentEngineRpm"] == 0 {
        return
    }

    if isFlagPassed("d") == true {

        log.Printf("RPM: %.0f \t Gear: %d \t BHP: %.0f \t Speed: %.0f \t Total slip: %.0f \t Attitude: %s", f32map["CurrentEngineRpm"], u8map["Gear"], (f32map["Power"] / 745.7), (f32map["Speed"] * 2.237))
        log.Printf("DistanceTraveled: %.0f", f32map["DistanceTraveled"])
    }

    if timingData.Car.CarNumber != int(s32map["CarOrdinal"]) || timingData.Car.CarClass != int(s32map["CarClass"]) {
        // Update CarNumber and CarClass
        timingData.Car.CarNumber = int(s32map["CarOrdinal"])
        timingData.Car.CarClass = int(s32map["CarClass"])

        // Check if the game is "FM" and TrackOrdinal exists
        if motorsport && checkKeyExists(s32map, "TrackOrdinal") {
            timingData.Car.TrackNumber = int(s32map["TrackOrdinal"])
            } else {
                timingData.Car.TrackNumber = -1 // Set default value if TrackOrdinal is not found
            }
        timingData.BestSplits, err = getTimingSplits(timingData.Car)
        timingData.BestCarTrack, timingData.BestCarTrackSplits, err = getBestCarforTrack(timingData.Car)
    } else if trackOrdinal, ok := s32map["TrackOrdinal"]; ok {
        // Check if TrackOrdinal exists and is different from current TrackNumber
        if timingData.Car.TrackNumber != int(trackOrdinal) {
            // Update Car properties
            timingData.Car.CarNumber = int(s32map["CarOrdinal"])
            timingData.Car.CarClass = int(s32map["CarClass"])
            timingData.Car.TrackNumber = int(trackOrdinal)
            timingData.BestSplits, err = getTimingSplits(timingData.Car)
            timingData.BestCarTrack, timingData.BestCarTrackSplits, err = getBestCarforTrack(timingData.Car)
        }
    }

    if isRaceOn, ok := s32map["IsRaceOn"]; ok && isRaceOn == 1  {
        f32map["Split"] = UpdateSplit(&timingData, f32map["DistanceTraveled"], u16map["LapNumber"], f32map["CurrentLap"], f32map["LastLap"], f32map["SessionBestLap"]);

        // Set best Lap
        if(len(timingData.BestSplits) > 0) {
            f32map["BestLap"] = timingData.BestSplits[len(timingData.BestSplits)-1];
        } else {
            f32map["BestLap"] = 0;
        }
    }else {
        // timingData.TimingSplits = []float32{}
        // timingData.BestSplits = []float32{}
        // timingData.SessionSplits = []float32{}

        f32map["Split"] = maxFloat;
        f32map["BestLap"] = 0;
    }

    if isFlagPassed("j") == true {
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

        jsonData = fmt.Sprintf("%s", finalJSON)
    }
}

func checkKeyExists[K comparable, V any](m map[K]V, key K) bool {
    _, exists := m[key]
    return exists
}

func setTimingSplits(data TimingData) error {
    if(!motorsport || data.Car.TrackNumber == -1) {
        fmt.Errorf("Storing splits not allowed for game")
        return nil
    }

    // Create the directory path based on car class, car number, and track number
    dirPath := fmt.Sprintf("data/splits/%d/%d", data.Car.CarClass, data.Car.CarNumber)

    // Create the directories (including parent directories if needed)
    err := os.MkdirAll(dirPath, 0755)
    if err != nil {
        return fmt.Errorf("failed to create directory: %v", err)
    }

    // Create the full path for the JSON file
    filePath := filepath.Join(dirPath, fmt.Sprintf("%d.json", data.Car.TrackNumber))

    // Open the file for writing (create or truncate if it already exists)
    file, err := os.Create(filePath)
    if err != nil {
        return fmt.Errorf("failed to create JSON file: %v", err)
    }
    defer file.Close()

    // Encode TimingSplits to JSON and write to the file
    encoder := json.NewEncoder(file)
    encoder.SetIndent("", "  ") // Pretty-print JSON with indentation
    err = encoder.Encode(data.TimingSplits)
    if err != nil {
        return fmt.Errorf("failed to write JSON data: %v", err)
    }

    fmt.Printf("Timing data successfully written to %s\n", filePath)
    return nil
}

func getTimingSplits(car CarDescription) ([]float32, error) {
    // Construct the path to the JSON file
    filePath := filepath.Join("data", "splits", fmt.Sprintf("%d", car.CarClass), fmt.Sprintf("%d", car.CarNumber), fmt.Sprintf("%d.json", car.TrackNumber))

    // Check if the file exists
    if _, err := os.Stat(filePath); os.IsNotExist(err) {
        return nil, fmt.Errorf("file %s does not exist", filePath)
    }

    // Read the file contents
    fileData, err := ioutil.ReadFile(filePath)
    if err != nil {
        return nil, fmt.Errorf("failed to read file: %v", err)
    }

    // Decode the JSON data into a []float32
    var splits []float32
    err = json.Unmarshal(fileData, &splits)
    if err != nil {
        return nil, fmt.Errorf("failed to decode JSON data: %v", err)
    }

    return splits, nil
}

var g_lap = -1
var g_valid = false
func UpdateSplit(timingData *TimingData, distance float32, lap uint16, time float32, last float32, best float32) float32 {
    // Round time to 2 decimal places
    time = float32(math.Round(float64(time*100)) / 100)

    // Skip lap handling if distance is negative
    if distance < 0 {
        g_lap = -1
        return maxFloat
    }

    // Check if a new lap should be configured (distance reset to zero)
    if g_lap < int(lap) {
        g_lap = int(lap)
        g_valid = true

        if time > .2 {
            g_valid = false
            return maxFloat
        }

        if g_lap == 0 {
            // Reset timing data for a new session
            timingData.BestSplits = []float32{}
            timingData.SessionSplits = []float32{}

            // Get lap splits from storage
            var err error
            timingData.BestSplits, err = getTimingSplits(timingData.Car)
            timingData.BestCarTrack, timingData.BestCarTrackSplits, err = getBestCarforTrack(timingData.Car)
            if err != nil {
                fmt.Println("Error getting timing splits:", err)
            }
        }

        if len(timingData.TimingSplits) > 1 && timingData.TimingSplits[len(timingData.TimingSplits)-1] + 2 > last {
            timingData.TimingSplits = append(timingData.TimingSplits, float32(math.Round(float64(last*1000)) / 1000))

            // Update best and session splits if last time matches best
            if timingData.TimingSplits[0] != -1 && last > 0 && last == best {
                if len(timingData.BestSplits) == 0 || best < timingData.BestSplits[len(timingData.BestSplits)-1] {
                    timingData.BestSplits = append([]float32(nil), timingData.TimingSplits...) // Copy splits to BestSplits
                    if timingData.Car.TrackNumber != -1 {
                        err := setTimingSplits(*timingData)
                        if err != nil {
                            fmt.Println("Error storing timing data:", err)
                        }
                    }

                    if last < Last(timingData.BestCarTrackSplits) && timingData.Car.CarNumber != timingData.BestCarTrack.CarNumber {
                        timingData.BestCarTrackSplits = timingData.TimingSplits;
                        timingData.BestCarTrack = timingData.Car;
                        setBestCarForTrack(timingData.Car)
                    }
                }

                if len(timingData.SessionSplits) == 0 || best < timingData.SessionSplits[len(timingData.SessionSplits)-1] {
                    timingData.SessionSplits = append([]float32(nil), timingData.TimingSplits...) // Copy splits to SessionSplits
                }
            }
        }
        // Reset current lap splits for the next lap
        timingData.TimingSplits = []float32{}
        timingData.startMeters = distance
    }

    if !g_valid {
        return maxFloat
    }

    // Update timing splits during the lap
    traveled := distance - timingData.startMeters
    index := int(math.Floor(float64(traveled) / float64(splitDistance))) - 1

    if index < 0 {
        return maxFloat
    } else if index+1 < len(timingData.TimingSplits) {
        timingData.TimingSplits = timingData.TimingSplits[:index]
        timingData.TimingSplits = append(timingData.TimingSplits, time)

        // Invalidate lap if rewound to previous split
        timingData.TimingSplits[0] = -1
    } else if index == len(timingData.TimingSplits) {
        // Add a new split in sequence
        timingData.TimingSplits = append(timingData.TimingSplits, time)
    } else if index < len(timingData.TimingSplits) {
        // Do nothing if the index is within range but not needing updates
    } else {
        fmt.Println("Error: Split index out of range", index, len(timingData.TimingSplits))
        return maxFloat
    }


    bestIndex := index
    var targetSplits []float32
    if(motorsport && splitType == ClassSpecific) {
        targetSplits = timingData.BestCarTrackSplits
    } else if motorsport && splitType == CarSpecific {
        targetSplits = timingData.BestSplits
    } else {
        targetSplits = timingData.SessionSplits
    }

    if len(targetSplits) == 0 {
        return maxFloat
    } else if index >= len(targetSplits) {
        bestIndex = len(targetSplits) - 1
    }

    return timingData.TimingSplits[index] - targetSplits[bestIndex]
}

// ReadTopInt reads the first line of a file, trims any whitespace, and converts it to an integer.
func getBestCarforTrack(car CarDescription) (CarDescription, []float32, error) {
    // Open the file
    var trackCar = CarDescription{
        CarNumber: -1,
        TrackNumber: -1,
        CarClass: -1,
    }

    filePath := filepath.Join("data", "splits", fmt.Sprintf("%d", car.CarClass), fmt.Sprintf("%d", car.TrackNumber))
    file, err := os.Open(filePath)
    if err != nil {
        return trackCar, []float32{}, fmt.Errorf("failed to open file: %w", err)
    }
    defer file.Close()

    // Read the first line using a scanner
    scanner := bufio.NewScanner(file)
    if scanner.Scan() {
        line := strings.TrimSpace(scanner.Text())
        // Convert the line to an integer
        value, err := strconv.Atoi(line)
        if err != nil {
            return trackCar, []float32{}, fmt.Errorf("failed to convert to int: %w", err)
        }

        trackCar = CarDescription{
            CarNumber: value,
            TrackNumber: car.TrackNumber,
            CarClass: car.CarClass,
        }

        splits, err := getTimingSplits(trackCar)
        if len(splits) == 0 {
            return trackCar, []float32{}, fmt.Errorf("error reading file: ", err)
        }
            
        return trackCar, splits, nil
    }

    // Check for scanner errors
    if err := scanner.Err(); err != nil {
        return trackCar, []float32{}, fmt.Errorf("error reading file: %w", err)
    }

    return trackCar, []float32{}, fmt.Errorf("file is empty")
}

func setBestCarForTrack(car CarDescription) error {
    // Construct the file path
    filePath := filepath.Join("data", "splits", fmt.Sprintf("%d", car.CarClass), fmt.Sprintf("%d", car.TrackNumber))

    // Create the directory if it doesn't exist
    if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
        return fmt.Errorf("failed to create directory: %w", err)
    }

    // Open the file for writing (create or truncate if it already exists)
    file, err := os.Create(filePath)
    if err != nil {
        return fmt.Errorf("failed to open file: %w", err)
    }
    defer file.Close()

    // Write the car number and best time to the file
    _, err = fmt.Fprintf(file, "%d", car.CarNumber)
    if err != nil {
        return fmt.Errorf("failed to write to file: %w", err)
    }

    return nil
}

func main() {
    var game string;
    var splitTypeSTR string;

    flag.StringVar(&game, "game", "FM", "Specify an abreviated game ie: FM, FH5")
    jsonPTR := flag.Bool("j", true, "Enables JSON HTTP server on port 8888")
    flag.StringVar(&splitTypeSTR, "split", "car", "car(overall)/class(overall)/session based splits")
    debugModePTR := flag.Bool("d", false, "Enables extra debug information if set")
    flag.Parse()

    jsonEnabled := *jsonPTR

    if splitTypeSTR == "car" {
        splitType = CarSpecific
    }else if splitTypeSTR == "class" {
        splitType = ClassSpecific
    }else if splitTypeSTR == "session" {
        splitType = Session
    }else {
        fmt.Errorf("Invalid split type %s", splitTypeSTR)
        return
    }

    if strings.HasPrefix(game, "FM") {
        motorsport = true
    }

    debugMode := *debugModePTR

    SetupCloseHandler() // handle CTRL+C

    if debugMode {
        log.Println("Debug mode enabled")
    }

    var formatFile = "packets/" + game + "_packetformat.dat"

    // Load lines from packet format file
    lines, err := readLines(formatFile)
    if err != nil {
        log.Fatalf("Error reading format file: %s", err)
    }

    // Process format file into array of Telemetry structs
    startOffset := 0
    endOffset := 0
    dataLength := 0
    totalLength := 0
    var telemArray []Telemetry

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
            telemItem := Telemetry{i, dataName, dataType, startOffset, endOffset}
            telemArray = append(telemArray, telemItem)
        case "u32":
            dataLength = 4
            endOffset = endOffset + dataLength
            startOffset = endOffset - dataLength
            totalLength = totalLength + dataLength
            telemItem := Telemetry{i, dataName, dataType, startOffset, endOffset}
            telemArray = append(telemArray, telemItem)
        case "f32":
            dataLength = 4
            endOffset = endOffset + dataLength
            startOffset = endOffset - dataLength
            totalLength = totalLength + dataLength
            telemItem := Telemetry{i, dataName, dataType, startOffset, endOffset}
            telemArray = append(telemArray, telemItem)
        case "u16":
            dataLength = 2
            endOffset = endOffset + dataLength
            startOffset = endOffset - dataLength
            totalLength = totalLength + dataLength
            telemItem := Telemetry{i, dataName, dataType, startOffset, endOffset}
            telemArray = append(telemArray, telemItem)
        case "u8":
            dataLength = 1
            endOffset = endOffset + dataLength
            startOffset = endOffset - dataLength
            totalLength = totalLength + dataLength
            telemItem := Telemetry{i, dataName, dataType, startOffset, endOffset}
            telemArray = append(telemArray, telemItem)
        case "s8":
            dataLength = 1
            endOffset = endOffset + dataLength
            startOffset = endOffset - dataLength
            totalLength = totalLength + dataLength
            telemItem := Telemetry{i, dataName, dataType, startOffset, endOffset}
            telemArray = append(telemArray, telemItem)
        case "hzn":
            dataLength = 12
            endOffset = endOffset + dataLength
            startOffset = endOffset - dataLength
            totalLength = totalLength + dataLength
            telemItem := Telemetry{i, dataName, dataType, startOffset, endOffset}
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
        log.Printf("Proccessed %d Telemetry types OK!", len(telemArray))
    }


    if jsonEnabled {
        go serveJSON()
    }

    // Setup UDP listener
    udpAddr, err := net.ResolveUDPAddr("udp4", service)
    if err != nil {
        log.Fatal(err)
    }

    listener, err := net.ListenUDP("udp", udpAddr)
    check(err)
    defer listener.Close()

    if(debugMode){
        log.Printf("Forza data out server listening on %s:%s, waiting for Forza data...\n", GetOutboundIP(), port)
    }

    for {
        readForzaData(listener, telemArray, totalLength)
    }
}

func init() {
    log.SetFlags(log.Lmicroseconds)
    if isFlagPassed("d") == true {
        log.Println("Started Forza Data Tools")
    }
}

// Helper functions

// SetupCloseHandler performs some clean up on exit (CTRL+C)
func SetupCloseHandler() {
    c := make(chan os.Signal, 2)
    signal.Notify(c, os.Interrupt, syscall.SIGTERM)
    go func() {
        <-c
        os.Exit(0)
    }()
}

// Quick error check helper
func check(e error) {
    if e != nil {
        log.Fatalln(e)
    }
}

// Check if flag was passed
func isFlagPassed(name string) bool {
    found := false
    flag.Visit(func(f *flag.Flag) {
        if f.Name == name {
            found = true
        }
    })
    return found
}

// Float32frombytes converts bytes into a float32
func Float32frombytes(bytes []byte) float32 {
    bits := binary.LittleEndian.Uint32(bytes)
    float := math.Float32frombits(bits)
    return float
}

// readLines reads a whole file into memory and returns a slice of its lines
func readLines(path string) ([]string, error) {
    file, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    defer file.Close()

    var lines []string
    scanner := bufio.NewScanner(file)
    for scanner.Scan() {
        lines = append(lines, scanner.Text())
    }
    return lines, scanner.Err()
}

// GetOutboundIP finds preferred outbound ip of this machine
func GetOutboundIP() net.IP {
    conn, err := net.Dial("udp", "1.2.3.4:4321") // Destination does not need to exist, using this to see which is the primary network interface
    if err != nil {
        log.Fatal(err)
    }
    defer conn.Close()

    localAddr := conn.LocalAddr().(*net.UDPAddr)

    return localAddr.IP
}

func Last[T any](arr []T) (T) {
	if len(arr) == 0 {
		var zeroValue T // Return zero value for the type
		return zeroValue
	}
	return arr[len(arr)-1]
}