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

// readForzaData processes recieved UDP packets
func readForzaData(conn *net.UDPConn, telemArray []Telemetry) {
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

func main() {
	var game string;

	flag.StringVar(&game, "game", "FM", "Specify an abreviated game ie: FM, FH5")
	jsonPTR := flag.Bool("j", true, "Enables JSON HTTP server on port 8888")
	debugModePTR := flag.Bool("d", false, "Enables extra debug information if set")
	flag.Parse()

	jsonEnabled := *jsonPTR
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
		readForzaData(listener, telemArray)
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
