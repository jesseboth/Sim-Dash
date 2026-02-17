package game

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net"
	"os"
	"path/filepath"
	"time"

	"jesseboth/fdt/src/util"
)

// AssettoState holds the recording state for Assetto Corsa
type AssettoState struct {
	isRecording      bool
	recordingStarted time.Time
	currentCourseID  string
	telemetryBuffer  []util.TelemetrySample
	lastLapValue     float32
	lastLapTime      time.Time
	carID            int32
	trackID          int32
}

// AssettoLoop is the main loop for Assetto Corsa telemetry
func AssettoLoop(game string, conn *net.UDPConn, telemArray []util.Telemetry, totalLength int, debug bool) {
	log.Println("Starting Assetto Corsa Telemetry")

	state := &AssettoState{
		isRecording:     false,
		telemetryBuffer: make([]util.TelemetrySample, 0, 24000), // 10 min @ 40Hz
		lastLapValue:    -1,
	}

	for {
		AssettoReadData(conn, telemArray, totalLength, state, debug)
	}
}

// AssettoReadData reads UDP packet and processes telemetry
func AssettoReadData(conn *net.UDPConn, telemArray []util.Telemetry, totalLength int, state *AssettoState, debug bool) {
	buffer := make([]byte, 1500)

	n, addr, err := conn.ReadFromUDP(buffer)
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

	// Parse packet into typed maps
	f32map := make(map[string]float32)
	u8map := make(map[string]uint8)
	s32map := make(map[string]int32)

	for i, T := range telemArray {
		data := buffer[:n][T.StartOffset:T.EndOffset]

		if debug {
			log.Printf("Data chunk %d: %v (%s) (%s)", i, data, T.Name, T.DataType)
		}

		switch T.DataType {
		case "f32":
			f32map[T.Name] = util.Float32frombytes(data)
		case "u8":
			u8map[T.Name] = uint8(data[0])
		case "s32":
			s32map[T.Name] = int32(binary.LittleEndian.Uint32(data))
		}
	}

	// Update JSON endpoint with current telemetry
	updateJSONEndpoint(f32map, u8map, s32map)

	// Handle recording state machine
	handleRecording(state, f32map, s32map, debug)
}

// updateJSONEndpoint updates the live telemetry JSON
func updateJSONEndpoint(f32map map[string]float32, u8map map[string]uint8, s32map map[string]int32) {
	combinedMap := make(map[string]interface{})

	for k, v := range f32map {
		combinedMap[k] = v
	}
	for k, v := range u8map {
		combinedMap[k] = v
	}
	for k, v := range s32map {
		combinedMap[k] = v
	}

	// Add CarID and TrackID explicitly
	if carID, ok := s32map["CarID"]; ok {
		combinedMap["CarID"] = carID
	}
	if trackID, ok := s32map["TrackID"]; ok {
		combinedMap["TrackID"] = trackID
	}

	finalJSON, err := json.Marshal(combinedMap)
	if err != nil {
		log.Printf("Error marshalling JSON: %v", err)
		return
	}

	util.SetJson(string(finalJSON))
}

// handleRecording manages the recording state machine
func handleRecording(state *AssettoState, f32map map[string]float32, s32map map[string]int32, debug bool) {
	// Get recording state from API
	recordingState := util.GetRecordingState()

	// Check if we should start recording
	if recordingState.IsRecording && !state.isRecording {
		state.isRecording = true
		state.recordingStarted = time.Now()
		state.currentCourseID = recordingState.CourseID
		state.telemetryBuffer = state.telemetryBuffer[:0]
		state.lastLapValue = -1

		// Capture CarID and TrackID from telemetry
		if carID, ok := s32map["CarID"]; ok {
			state.carID = carID
		}
		if trackID, ok := s32map["TrackID"]; ok {
			state.trackID = trackID
		}

		if debug {
			log.Printf("Recording started for course: %s (CarID: %d, TrackID: %d)",
				state.currentCourseID, state.carID, state.trackID)
		}
	}

	// Check if we should stop recording via API
	if !recordingState.IsRecording && state.isRecording {
		if debug {
			log.Println("Recording stopped by user")
		}
		saveRun(state, debug)
		state.isRecording = false
		state.telemetryBuffer = state.telemetryBuffer[:0]
		return
	}

	// Only record if explicitly started via API
	if !state.isRecording {
		return
	}

	// Buffer telemetry sample
	var currentLap float32 = 0
	if currentLapMs, ok := s32map["CurrentLap"]; ok {
		currentLap = float32(currentLapMs) / 1000.0
	}
	sample := createTelemetrySample(f32map, s32map, state.recordingStarted)
	state.telemetryBuffer = append(state.telemetryBuffer, sample)

	// Update recording elapsed time
	util.UpdateRecordingElapsed(time.Since(state.recordingStarted).Seconds())

	// Check for run completion (lap timer stopped for 2s)
	if currentLap != state.lastLapValue {
		state.lastLapValue = currentLap
		state.lastLapTime = time.Now()
	} else if state.lastLapValue > 0 {
		// Lap hasn't changed and is > 0
		if time.Since(state.lastLapTime) > 2*time.Second {
			// Run complete - save and reset
			if debug {
				log.Println("Run complete - auto-detected stop")
			}
			saveRun(state, debug)
			state.isRecording = false
			state.telemetryBuffer = state.telemetryBuffer[:0]
			util.StopRecording()
		}
	}

	// Buffer overflow protection (10 minutes @ 40Hz = 24,000 samples)
	if len(state.telemetryBuffer) >= 24000 {
		if debug {
			log.Println("Buffer full - saving run")
		}
		saveRun(state, debug)
		state.isRecording = false
		state.telemetryBuffer = state.telemetryBuffer[:0]
		util.StopRecording()
	}
}

// createTelemetrySample creates a telemetry sample from the packet data
func createTelemetrySample(f32map map[string]float32, s32map map[string]int32, startTime time.Time) util.TelemetrySample {
	// Use Speed which is already in mph
	speed := f32map["Speed"]

	// CurrentLap is in milliseconds, convert to seconds
	var lapTime float32 = 0
	if currentLapMs, ok := s32map["CurrentLap"]; ok {
		lapTime = float32(currentLapMs) / 1000.0
	}

	return util.TelemetrySample{
		Timestamp: time.Since(startTime).Seconds(),
		Brake:     f32map["Brake"],
		Accel:     f32map["Accel"],
		AccelX:    f32map["AccelerationX"], // Lateral G (left/right)
		AccelY:    f32map["AccelerationZ"], // Longitudinal G (accel/brake) - FIXED from AccelerationY
		Speed:     speed,
		PosX:      f32map["PositionX"], // X coordinate
		PosY:      f32map["PositionZ"], // Z coordinate for top-down map - FIXED from PositionY
		PosZ:      f32map["PositionY"], // Y coordinate (elevation)
		LapTime:   lapTime,
	}
}

// saveRun saves the recorded run to disk
func saveRun(state *AssettoState, debug bool) {
	if len(state.telemetryBuffer) == 0 {
		log.Println("No telemetry data to save")
		return
	}

	// Prepare run data structure
	runData := prepareRunData(state)

	// Create directory if it doesn't exist (in telemetry/data/autocross/)
	runDir := filepath.Join("data", "autocross", state.currentCourseID, "runs")
	err := os.MkdirAll(runDir, 0755)
	if err != nil {
		log.Printf("Error creating run directory: %v", err)
		return
	}

	// Write to JSON file
	timestamp := time.Now().UnixMilli()
	filename := filepath.Join(runDir, fmt.Sprintf("run-%d.json", timestamp))

	file, err := os.Create(filename)
	if err != nil {
		log.Printf("Error creating run file: %v", err)
		return
	}
	defer file.Close()

	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	err = encoder.Encode(runData)
	if err != nil {
		log.Printf("Error writing run data: %v", err)
		return
	}

	if debug {
		log.Printf("Run saved: %s (%.3f seconds, %d samples)", filename, runData.LapTime, len(state.telemetryBuffer))
	}

	// Update top 10
	updateTop10(state.currentCourseID, runData, debug)
}

// prepareRunData converts buffered telemetry into run data structure
func prepareRunData(state *AssettoState) util.AutocrossRun {
	timestamps := make([]float64, len(state.telemetryBuffer))
	brake := make([]float32, len(state.telemetryBuffer))
	accel := make([]float32, len(state.telemetryBuffer))
	accelX := make([]float32, len(state.telemetryBuffer))
	accelY := make([]float32, len(state.telemetryBuffer))
	speed := make([]float32, len(state.telemetryBuffer))
	posX := make([]float32, len(state.telemetryBuffer))
	posY := make([]float32, len(state.telemetryBuffer))
	posZ := make([]float32, len(state.telemetryBuffer))

	var maxSpeed float32
	var maxLatG float32
	var maxLongG float32

	for i, sample := range state.telemetryBuffer {
		timestamps[i] = sample.Timestamp
		brake[i] = sample.Brake
		accel[i] = sample.Accel
		accelX[i] = sample.AccelX
		accelY[i] = sample.AccelY
		speed[i] = sample.Speed
		posX[i] = sample.PosX
		posY[i] = sample.PosY
		posZ[i] = sample.PosZ

		// Calculate statistics
		if sample.Speed > maxSpeed {
			maxSpeed = sample.Speed
		}
		if absFloat32(sample.AccelX) > maxLatG {
			maxLatG = absFloat32(sample.AccelX)
		}
		if absFloat32(sample.AccelY) > maxLongG {
			maxLongG = absFloat32(sample.AccelY)
		}
	}

	// Use actual recording duration as lap time (last timestamp)
	finalLapTime := float32(state.telemetryBuffer[len(state.telemetryBuffer)-1].Timestamp)

	runID := fmt.Sprintf("run-%d", time.Now().UnixMilli())

	return util.AutocrossRun{
		RunID:     runID,
		CourseID:  state.currentCourseID,
		Timestamp: time.Now().Format(time.RFC3339),
		LapTime:   finalLapTime,
		CarID:     fmt.Sprintf("%d", state.carID),
		TrackID:   fmt.Sprintf("%d", state.trackID),
		Cones:     0,
		Name:      "",
		IsValid:   true,
		Telemetry: util.AutocrossTelemetry{
			Timestamps: timestamps,
			Brake:      brake,
			Accel:      accel,
			AccelX:     accelX,
			AccelY:     accelY,
			Speed:      speed,
			PosX:       posX,
			PosY:       posY,
			PosZ:       posZ,
		},
		Statistics: util.AutocrossStatistics{
			MaxSpeed: maxSpeed,
			MaxLatG:  maxLatG,
			MaxLongG: maxLongG,
		},
	}
}

// updateTop10 updates the top 10 runs for a course
func updateTop10(courseID string, newRun util.AutocrossRun, debug bool) {
	top10File := filepath.Join("data", "autocross", courseID, "top10.json")

	// Read existing top 10
	var top10 []util.Top10Entry
	data, err := os.ReadFile(top10File)
	if err == nil {
		json.Unmarshal(data, &top10)
	}

	// Add new run
	newEntry := util.Top10Entry{
		RunID:        newRun.RunID,
		LapTime:      newRun.LapTime,
		Cones:        newRun.Cones,
		AdjustedTime: newRun.LapTime + float32(newRun.Cones)*2.0,
		Timestamp:    newRun.Timestamp,
		CarID:        newRun.CarID,
	}

	top10 = append(top10, newEntry)

	// Sort by adjusted time
	for i := 0; i < len(top10); i++ {
		for j := i + 1; j < len(top10); j++ {
			if top10[j].AdjustedTime < top10[i].AdjustedTime {
				top10[i], top10[j] = top10[j], top10[i]
			}
		}
	}

	// Keep only top 10
	if len(top10) > 10 {
		top10 = top10[:10]
	}

	// Write back to file
	file, err := os.Create(top10File)
	if err != nil {
		log.Printf("Error creating top10 file: %v", err)
		return
	}
	defer file.Close()

	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	encoder.Encode(top10)

	if debug {
		log.Printf("Top 10 updated for course: %s", courseID)
	}
}

// absFloat32 returns the absolute value of a float32
func absFloat32(x float32) float32 {
	return float32(math.Abs(float64(x)))
}
