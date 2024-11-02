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

    "encoding/json"
    "database/sql"
    _ "github.com/lib/pq" // PostgreSQL driver
)

const hostname = "0.0.0.0"            // Address to listen on (0.0.0.0 = all interfaces)
const port = "9999"                   // UDP Port number to listen on
const service = hostname + ":" + port // Combined hostname+port

var jsonData string // Stores the JSON data to be sent out via the web server if enabled

// Telemetry struct represents a piece of telemetry as defined in the Forza data format (see the .dat files)
type Telemetry struct {
    position    int
    name        string
    dataType    string
    startOffset int
    endOffset   int
}

type Split struct {
    SplitTime      float32 // Time as a float in seconds, e.g., 15.123
    SplitIndex     int
}

type CarDescription struct {
    CarNumber     int
    TrackNumber   int
    CarClass	  int
}

type TimingData struct {
    Car           CarDescription
    TimingSplits  []Split // Current lap splits
    BestSplits    []Split // Best splits for comparison
    SessionSplits []Split // Best splits for the current session

    startMeters   float32
}

var timingData TimingData
const splitDistance float32 = 12.0  // Distance per split, adjust as necessary

var g_db *sql.DB;
const maxFloat = 9999999999.0

// readForzaData processes recieved UDP packets
func readForzaData(conn *net.UDPConn, telemArray []Telemetry, game string) {
    buffer := make([]byte, 1500)

    n, addr, err := conn.ReadFromUDP(buffer)
    if err != nil {
        log.Fatal("Error reading UDP data:", err, addr)
    }

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
    if f32map["CurrentEngineRpm"] == 0 {
        return
    }

    if isFlagPassed("d") == true {

        log.Printf("RPM: %.0f \t Gear: %d \t BHP: %.0f \t Speed: %.0f \t Total slip: %.0f \t Attitude: %s", f32map["CurrentEngineRpm"], u8map["Gear"], (f32map["Power"] / 745.7), (f32map["Speed"] * 2.237))
        log.Printf("DistanceTraveled: %.0f", f32map["DistanceTraveled"])
    }

    timingData.Car.CarNumber = int(s32map["CarOrdinal"])
    if(strings.HasPrefix(game, "FM")) {
        timingData.Car.TrackNumber = int(s32map["TrackOridnal"])
    } else {
        timingData.Car.TrackNumber = -1
    }
    timingData.Car.CarClass = int(s32map["CarClass"])

    if s32map["IsRaceOn"] == 1 {
        f32map["Split"] = UpdateSplit(&timingData, f32map["DistanceTraveled"], u16map["LapNumber"], f32map["CurrentLap"], f32map["LastLap"], f32map["BestLap"]);
    }else {
        f32map["Split"] = maxFloat;
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

func storeTimingData(data TimingData) error {
    if g_db == nil {
        return fmt.Errorf("database connection is not initialized")
    }

    tx, err := g_db.Begin()
    if err != nil {
        return err
    }
    defer tx.Rollback()

    var carID, trackID int

    // Insert or update car and track based on CarDescription details
    err = tx.QueryRow(`INSERT INTO cars (car_number) VALUES ($1)
                       ON CONFLICT (car_number) DO UPDATE SET car_number = EXCLUDED.car_number
                       RETURNING car_id`, data.Car.CarNumber).Scan(&carID)
    if err != nil {
        return err
    }

    err = tx.QueryRow(`INSERT INTO tracks (track_number) VALUES ($1)
                       ON CONFLICT (track_number) DO UPDATE SET track_number = EXCLUDED.track_number
                       RETURNING track_id`, data.Car.TrackNumber).Scan(&trackID)
    if err != nil {
        return err
    }

    // Delete existing timing splits for this car, track, and car class
    _, err = tx.Exec(`DELETE FROM timing_splits WHERE car_id = $1 AND track_id = $2 AND car_class = $3`,
        carID, trackID, data.Car.CarClass)
    if err != nil {
        return err
    }

    // Insert new timing splits
    for _, split := range data.TimingSplits {
        _, err = tx.Exec(`INSERT INTO timing_splits (car_id, track_id, car_class, split_time, split_index)
                          VALUES ($1, $2, $3, $4, $5)
                          ON CONFLICT (car_id, track_id, car_class, split_index) DO UPDATE
                          SET split_time = EXCLUDED.split_time`,
            carID, trackID, data.Car.CarClass, split.SplitTime, split.SplitIndex)
        if err != nil {
            return err
        }
    }

    return tx.Commit()
}

func getTimingSplits(car CarDescription) ([]Split, error) {
    if g_db == nil {
        return nil, fmt.Errorf("database connection is not initialized")
    }

    query := `
        SELECT ts.split_time, ts.split_index
        FROM timing_splits ts
        JOIN cars c ON ts.car_id = c.car_id
        JOIN tracks t ON ts.track_id = t.track_id
        WHERE c.car_number = $1 AND t.track_number = $2 AND ts.car_class = $3
        ORDER BY ts.split_index;
    `

    rows, err := g_db.Query(query, car.CarNumber, car.TrackNumber, car.CarClass)
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var splits []Split
    for rows.Next() {
        var split Split
        if err := rows.Scan(&split.SplitTime, &split.SplitIndex); err != nil {
            return nil, err
        }
        splits = append(splits, split)
    }

    if err := rows.Err(); err != nil {
        return nil, err
    }

    return splits, nil
}

var g_lap = -1
var g_valid = false
func UpdateSplit(timingData *TimingData, distance float32, lap uint16, time float32, last float32, best float32) float32 {
    // Round time to 2 decimal places
    time = float32(math.Round(float64(time*100)) / 100)

    // skip lap handling if distance is negative
    if(distance < 0) {
        g_lap = -1
        return maxFloat
    }

    // Check if a new lap should be configured (distance reset to zero)
    if g_lap < int(lap) {
        g_lap = int(lap);
        g_valid = true

        if time > .2 {
            g_valid = false
            return maxFloat
        }

        if g_lap == 0 {
            // Reset timing data for new session
            timingData.BestSplits = []Split{}
            timingData.SessionSplits = []Split{}

            // get lap splits from database
            var err error;
            timingData.BestSplits, err = getTimingSplits(timingData.Car)
            if(err != nil) {
                println("Error getting timing splits: ", err)
            }
        }

        if len(timingData.TimingSplits) > 1 {
            timingData.TimingSplits = append(timingData.TimingSplits, Split{
                SplitTime: float32(math.Round(float64(last*1000)) / 1000),
                SplitIndex: len(timingData.TimingSplits),
            })

            // Update best and session splits if last time matches best
            if timingData.TimingSplits[0].SplitTime != -1 && last == best {
                if len(timingData.BestSplits) == 0 || best < timingData.BestSplits[len(timingData.BestSplits)-1].SplitTime {
                    timingData.BestSplits = append([]Split(nil), timingData.TimingSplits...) // Copy splits to BestSplits
                    println("Best lap time: ", timingData.BestSplits[len(timingData.BestSplits)-1].SplitTime )
                    if(timingData.Car.TrackNumber != -1) {
                        err := storeTimingData(*timingData)
                        if(err != nil) {
                            println("Error storing timing data: ", err)
                        }
                    }
                }

                if len(timingData.SessionSplits) == 0 || best < timingData.SessionSplits[len(timingData.SessionSplits)-1].SplitTime {
                    timingData.SessionSplits = append([]Split(nil), timingData.TimingSplits...); // Copy splits to SessionSplits
                }
            }
        }
        // Reset current lap splits for the next lap
        timingData.TimingSplits = []Split{};
        timingData.startMeters = distance;
        println("timeData.startMeters: ", timingData.startMeters)
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
        timingData.TimingSplits[index] = Split{SplitTime: time, SplitIndex: index}

        // Invalidate lap if rewounnd to previous split
        if len(timingData.TimingSplits) > 0 {
            timingData.TimingSplits[0].SplitTime = -1
        }
    } else if index == len(timingData.TimingSplits) {
        // Add a new split in sequence
        timingData.TimingSplits = append(timingData.TimingSplits, Split{SplitTime: time, SplitIndex: index})
    } else if index < len(timingData.TimingSplits) {
    } else {
        fmt.Println("Error: Split index out of range ", index, len(timingData.TimingSplits))
        return maxFloat
    }

    bestIndex := index
    if len(timingData.BestSplits) == 0 {
        return maxFloat
    } else if index >= len(timingData.BestSplits) {
        bestIndex = len(timingData.BestSplits) - 1
    }

    return timingData.TimingSplits[index].SplitTime - timingData.BestSplits[bestIndex].SplitTime
}

// OpenDBConnection initializes and returns a new *sql.DB instance.
func OpenDBConnection(host, port, user, password, dbname string) (*sql.DB, error) {
    // Create the connection string
    connStr := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
        host, port, user, password, dbname)

    // Open the database connection
    dbret, err := sql.Open("postgres", connStr)
    if err != nil {
        return nil, fmt.Errorf("failed to open database connection: %v", err)
    }

    // Ping the database to ensure the connection is valid
    if err := dbret.Ping(); err != nil {
        dbret.Close()
        return nil, fmt.Errorf("failed to ping database: %v", err)
    }

    fmt.Println("Connected to the database successfully.")
    return dbret, nil
}

func main() {
    var game string;

    flag.StringVar(&game, "game", "FM", "Specify an abreviated game ie: FM, FH5")
    jsonPTR := flag.Bool("j", true, "Enables JSON HTTP server on port 8888")
    debugModePTR := flag.Bool("d", false, "Enables extra debug information if set")
    flag.Parse()

    jsonEnabled := *jsonPTR
    debugMode := *debugModePTR

    SetupCloseHandler() // handle CTRL+C

    g_db, err := OpenDBConnection("localhost", "5432", "postgres", "simrace", "postgres");

    if g_db == nil || err != nil {
        fmt.Printf("Error initializing database: %v\n", err)
        return
    }

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
            telemItem := Telemetry{i, dataName, dataType, startOffset, endOffset}
            telemArray = append(telemArray, telemItem)
        case "u32":
            dataLength = 4
            endOffset = endOffset + dataLength
            startOffset = endOffset - dataLength
            telemItem := Telemetry{i, dataName, dataType, startOffset, endOffset}
            telemArray = append(telemArray, telemItem)
        case "f32":
            dataLength = 4
            endOffset = endOffset + dataLength
            startOffset = endOffset - dataLength
            telemItem := Telemetry{i, dataName, dataType, startOffset, endOffset}
            telemArray = append(telemArray, telemItem)
        case "u16":
            dataLength = 2
            endOffset = endOffset + dataLength
            startOffset = endOffset - dataLength
            telemItem := Telemetry{i, dataName, dataType, startOffset, endOffset}
            telemArray = append(telemArray, telemItem)
        case "u8":
            dataLength = 1
            endOffset = endOffset + dataLength
            startOffset = endOffset - dataLength
            telemItem := Telemetry{i, dataName, dataType, startOffset, endOffset}
            telemArray = append(telemArray, telemItem)
        case "s8":
            dataLength = 1
            endOffset = endOffset + dataLength
            startOffset = endOffset - dataLength
            telemItem := Telemetry{i, dataName, dataType, startOffset, endOffset}
            telemArray = append(telemArray, telemItem)
        case "hzn":
            dataLength = 12
            endOffset = endOffset + dataLength
            startOffset = endOffset - dataLength
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
        readForzaData(listener, telemArray, game)
    }

    defer g_db.Close()
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

// CheckAttitude looks for balance of the car
func CheckAttitude(totalSlipFront int, totalSlipRear int) string {
    // Check attitude of car by comparing front and rear slip levels
    // If front slip > rear slip, means car is understeering
    if totalSlipRear > totalSlipFront {
        // log.Printf("Car is oversteering")
        return "Oversteer"
    } else if totalSlipFront > totalSlipRear {
        // log.Printf("Car is understeering")
        return "Understeer"
    } else {
        // log.Printf("Car balance is neutral")
        return "Neutral"
    }
}
