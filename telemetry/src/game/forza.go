package game

import (
    "encoding/binary"
    "encoding/json"
    "io/ioutil"
    "log"
    "fmt"
    "math"
    "net"
    "os"
    "path/filepath"
    "strconv"

    "jesseboth/fdt/src/util"
)

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

type Odometer struct {
    Odometer float32
    carNumber int
    offset float32
    distance float32
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

var odometer = Odometer{
    Odometer: 0,
    carNumber: 0,
    offset: 0,
    distance: 0,
}

const splitDistance float32 = 12.0  // Distance per split, adjust as necessary
const maxFloat = 9999999999.0
var splitType SplitType = Unknown;
var motorsport bool = false;

func ForzaLoop(game string, conn *net.UDPConn, telemArray []util.Telemetry, totalLength int, debug bool) {
    log.Println("Starting Telemetry:", ForzaGame(game))
    for {
        ForzaReadData(conn, telemArray, totalLength, debug)
    }
}

func Forza(game string) bool {
    switch game {
        case "FM":
            setMotorport(true)
        case "FM7":
            setMotorport(true)
        case "FH5":
        case "FH4":
        default:
            return false
        
        }
    return true;
}

func ForzaGame(game string) string {
    var gameSTR string = "";
    switch game {
        case "FM":
            gameSTR = "Forza Motorsport"
        case "FM7":
            gameSTR = "Forza Motorsport 7"
        case "FH5":
            gameSTR = "Forza Horizon 5"
        case "FH4":
            gameSTR = "Forza Horizon 4"
        default:
            return "Unknown"
        
        }
    return gameSTR;
}

func ForzaSetSplit(split string) {
    if split == "car" {
        splitType = CarSpecific
    }else if split == "class" {
        splitType = ClassSpecific
    }else if split == "session" {
        splitType = Session
   }else {
        fmt.Errorf("Invalid split type %s", split)
        return
    }
}

func ForzaReadData(conn *net.UDPConn, telemArray []util.Telemetry, totalLength int, debug bool) {
    buffer := make([]byte, 1500)

    n, addr, err := conn.ReadFromUDP(buffer)
    if err != nil {
        log.Fatal("Error reading UDP data:", err, addr)
    } else if n < totalLength {
        if(util.WrongData <= 5) {
            util.WrongData++;
        } else {
            util.SetJson("")
        }
        return
    }

    util.WrongData = 0;
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

    // Dont print / log / do anything if RPM is zero
    // This happens if the game is paused or you rewind
    // There is a bug with FH4 where it will continue to send data when in certain menus
    if !motorsport && f32map["CurrentEngineRpm"] == 0 {
        return
    }

    if debug {
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
        f32map["Split"] = updateSplit(&timingData, f32map["DistanceTraveled"], u16map["LapNumber"], f32map["CurrentLap"], f32map["LastLap"], f32map["SessionBestLap"]);
        f32map["Odometer"] = updateOdometer(f32map["DistanceTraveled"], s32map["CarOrdinal"], f32map["Speed"]);

        // Set best Lap
        if(splitType == CarSpecific && len(timingData.BestSplits) > 0) {
            f32map["BestLap"] = lastVal(timingData.BestSplits);
        } else if(splitType == ClassSpecific && len(timingData.BestCarTrackSplits) > 0) {
            f32map["BestLap"] = lastVal(timingData.BestCarTrackSplits);
        } else if(splitType == Session && len(timingData.SessionSplits) > 0) {
            f32map["BestLap"] = lastVal(timingData.SessionSplits);
        } else {
            f32map["BestLap"] = 0;
        }
    }else {

        // Set odometer and reset car number
        setOdometer(odometer);
        odometer.carNumber = 0;

        f32map["Split"] = maxFloat;
        f32map["BestLap"] = 0;
        f32map["Odometer"] = 0;
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

    log.Printf("Timing data successfully written to %s\n", filePath)
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
func updateSplit(timingData *TimingData, distance float32, lap uint16, time float32, last float32, best float32) float32 {
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
            if err != nil {
                log.Println("Error getting timing splits:", err)
            }
            timingData.BestCarTrack, timingData.BestCarTrackSplits, err = getBestCarforTrack(timingData.Car)
        }

        if len(timingData.TimingSplits) > 1 && lastVal(timingData.TimingSplits) + 2 > last {
            timingData.TimingSplits = append(timingData.TimingSplits, float32(math.Round(float64(last*1000)) / 1000))

            // Update best and session splits if last time matches best
            if timingData.TimingSplits[0] != -1 && last > 0 && last == best {
                if len(timingData.BestSplits) == 0 || best < lastVal(timingData.BestSplits) {
                    timingData.BestSplits = append([]float32(nil), timingData.TimingSplits...) // Copy splits to BestSplits
                    if timingData.Car.TrackNumber != -1 {
                        err := setTimingSplits(*timingData)
                        if err != nil {
                            log.Println("Error storing timing data:", err)
                        }
                    }

                    if last < lastVal(timingData.BestCarTrackSplits) {
                        timingData.BestCarTrackSplits = timingData.TimingSplits;
                        timingData.BestCarTrack = timingData.Car;
                        setBestCarForTrack(timingData.Car)
                    }
                }

                if len(timingData.SessionSplits) == 0 || best < lastVal(timingData.SessionSplits) {
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
        log.Println("Error: Split index out of range", index, len(timingData.TimingSplits))
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

const odometerBounce = 25.0
const frameTime float32 = 1.0 / 30.0
var prevVelocity float32 = -1
func updateOdometer(distance float32, carNumber uint32, velocity float32) float32 {
    if(odometer.carNumber <= 0) {
        odometer.carNumber = int(carNumber);

        odometer.Odometer = getOdometer(odometer.carNumber);
        odometer.offset = distance;
        odometer.distance = distance;
        prevVelocity = -1;
    } else if (distance == 0 && velocity > 5){
        odometer.offset = 0;
        if(velocity != prevVelocity) {
            odometer.distance += (velocity * frameTime)
        }
        prevVelocity = velocity;
    } else if (distance == 0 && prevVelocity != -1) {
        setOdometer(odometer);
        odometer.Odometer += odometer.distance - odometer.offset;
        odometer.offset = 0;
        odometer.distance = 0;
        prevVelocity = -1;
    } else if (odometer.carNumber != int(carNumber)) {
        setOdometer(odometer);

        odometer.carNumber = int(carNumber);
        odometer.Odometer = getOdometer(odometer.carNumber);
        odometer.offset = distance;
        odometer.distance = distance;
        prevVelocity = -1;
    } else if (odometer.distance-odometerBounce > distance) {
        // rewind handling
        setOdometer(odometer);
        odometer.offset = distance;
        odometer.distance = distance;
        prevVelocity = -1;
    } else {
        prevVelocity = -1;
        odometer.distance = distance;
    }

    if(distance < 0) {
        odometer.offset = 0;
        odometer.distance = 0;
        return odometer.Odometer;
    } else {
        return odometer.Odometer + odometer.distance - odometer.offset;
    }

    return 0;
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

    line, err := util.ReadFileTop(filePath)
    if err != nil {
        return trackCar, []float32{}, fmt.Errorf("error reading file: ", err)
    }

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

func setBestCarForTrack(car CarDescription) error {
    
    // Construct the file path
    filePath := filepath.Join("data", "splits", fmt.Sprintf("%d", car.CarClass), fmt.Sprintf("%d", car.TrackNumber))

    err := util.WriteFileTop(filePath, fmt.Sprintf("%d", car.CarNumber))
    if err != nil {
        return fmt.Errorf("failed to write to file: %w", err)
    }

    return nil
}

func getOdometer(CarNumber int) (float32) {

    filePath := filepath.Join("data", "odometers", fmt.Sprintf("%d", CarNumber))

    line, err := util.ReadFileTop(filePath)
    if err != nil {
        return 0
    }

    value, err := strconv.ParseFloat(line, 32)
    if err != nil {
        return 0
    }

    return float32(value)
}

func setOdometer(odo Odometer) error {
    if odo.carNumber <= 0 {
        return fmt.Errorf("Invalid car number")
    }

    // Construct the file path
    filePath := filepath.Join("data", "odometers", fmt.Sprintf("%d", odo.carNumber))

    store := odo.Odometer+odo.distance-odo.offset
    if(store < 0 || odo.Odometer > store) {
        return fmt.Errorf("Invalid odometer value")
    }

    err := util.WriteFileTop(filePath, fmt.Sprintf("%f", store))
    if err != nil {
        return fmt.Errorf("failed to write to file: %w", err)
    }

    return nil
}

func lastVal(arr []float32) float32 {
    if len(arr) == 0 {
        return 3.402823466e+38 // Max value for float32
    }
    return arr[len(arr)-1]
}

func setMotorport(value bool) {
    motorsport = value
}