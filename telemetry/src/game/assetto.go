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
	runActive        bool      // currently buffering a run
	recordingEnabled bool      // auto-detection enabled via API
	runStarted       time.Time // wall clock when run buffer began
	currentCourseID  string
	telemetryBuffer  []util.TelemetrySample
	prevLapValue     float32   // previous CurrentLap value to detect transitions
	lapFreezeValue   float32   // last non-zero lap value seen (for freeze detection)
	lapFreezeTime    time.Time // when lapFreezeValue last changed
	lastCarID        int32
	lastTrackID      int32
	completedLapMs   int32     // LastLap captured at run completion (most accurate time)
}

// AssettoLoop is the main loop for Assetto Corsa telemetry
func AssettoLoop(game string, conn *net.UDPConn, telemArray []util.Telemetry, totalLength int, debug bool) {
	log.Println("Starting Assetto Corsa Telemetry")

	state := &AssettoState{
		telemetryBuffer: make([]util.TelemetrySample, 0, 24000), // 10 min @ 40Hz
		prevLapValue:    -1,
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
		combinedMap[k] = math.Round(float64(v)*100) / 100
	}
	for k, v := range u8map {
		combinedMap[k] = v
	}
	for k, v := range s32map {
		combinedMap[k] = v
	}

	// Convert lap times from milliseconds to seconds for dashboard compatibility
	for _, field := range []string{"CurrentLap", "LastLap", "BestLap"} {
		if ms, ok := s32map[field]; ok {
			combinedMap[field] = math.Round(float64(ms)/10) / 100 // ms → seconds, 2 decimal places
		}
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
	// Always track car/track IDs from every packet
	if carID, ok := s32map["CarId"]; ok && carID != 0 {
		state.lastCarID = carID
	}
	if trackID, ok := s32map["TrackId"]; ok && trackID != 0 {
		state.lastTrackID = trackID
	}

	// Sync enabled state from API
	apiState := util.GetRecordingState()
	if apiState.IsRecording && !state.recordingEnabled {
		state.recordingEnabled = true
		state.currentCourseID = apiState.CourseID
		state.telemetryBuffer = state.telemetryBuffer[:0]
		state.prevLapValue = -1
		if debug {
			log.Printf("Auto-detection enabled for course: %s", state.currentCourseID)
		}
	} else if !apiState.IsRecording && state.recordingEnabled {
		// User stopped - discard any in-progress run, do NOT save
		state.recordingEnabled = false
		state.runActive = false
		state.telemetryBuffer = state.telemetryBuffer[:0]
		if debug {
			log.Println("Auto-detection disabled, in-progress run discarded")
		}
		return
	}

	if !state.recordingEnabled {
		return
	}

	// Read current lap timer (milliseconds → seconds)
	var currentLap float32
	if currentLapMs, ok := s32map["CurrentLap"]; ok {
		currentLap = float32(currentLapMs) / 1000.0
	}

	// Detect run start: timer transitions from 0 to >0
	if !state.runActive && currentLap > 0 && state.prevLapValue == 0 {
		state.runActive = true
		state.runStarted = time.Now()
		state.telemetryBuffer = state.telemetryBuffer[:0]
		state.completedLapMs = 0
		state.lapFreezeValue = currentLap
		state.lapFreezeTime = time.Now()
		if debug {
			log.Println("Run started - lap timer began")
		}
	}

	// Detect run end: timer resets to 0 (finish line / next lap)
	// Must check BEFORE updating prevLapValue
	if state.runActive && currentLap == 0 && state.prevLapValue > 0 {
		if debug {
			log.Println("Run complete - lap timer reset to 0")
		}
		// Use LastLap from AC as the authoritative completed lap time
		if lastLapMs, ok := s32map["LastLap"]; ok && lastLapMs > 0 {
			state.completedLapMs = lastLapMs
		}
		saveRun(state, debug)
		state.runActive = false
		state.telemetryBuffer = state.telemetryBuffer[:0]
		state.prevLapValue = 0
		util.NotifyRunSaved()
		return
	}

	// Update prevLapValue for next packet
	state.prevLapValue = currentLap

	if !state.runActive {
		return
	}

	// Buffer sample
	sample := createTelemetrySample(f32map, s32map, state.runStarted)
	state.telemetryBuffer = append(state.telemetryBuffer, sample)

	// Update elapsed time shown in UI
	util.UpdateRecordingElapsed(time.Since(state.runStarted).Seconds())

	// Fallback: freeze detection (timer stopped for 2s mid-run)
	if currentLap != state.lapFreezeValue {
		state.lapFreezeValue = currentLap
		state.lapFreezeTime = time.Now()
	} else if currentLap > 0 && time.Since(state.lapFreezeTime) > 2*time.Second {
		if debug {
			log.Println("Run complete - lap timer froze")
		}
		saveRun(state, debug)
		state.runActive = false
		state.telemetryBuffer = state.telemetryBuffer[:0]
		util.NotifyRunSaved()
		return
	}

	// Buffer overflow protection (10 minutes @ 40Hz = 24,000 samples)
	if len(state.telemetryBuffer) >= 24000 {
		if debug {
			log.Println("Buffer full - saving run")
		}
		saveRun(state, debug)
		state.runActive = false
		state.telemetryBuffer = state.telemetryBuffer[:0]
		util.NotifyRunSaved()
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

	roundTenth := func(v float32) float32 {
		return float32(math.Round(float64(v)*10) / 10)
	}

	return util.TelemetrySample{
		Timestamp: time.Since(startTime).Seconds(),
		Brake:     f32map["Brake"],
		Accel:     f32map["Accel"],
		AccelX:    roundTenth(f32map["AccelerationX"]), // Lateral G (left/right)
		AccelY:    roundTenth(f32map["AccelerationZ"]), // Longitudinal G (accel/brake)
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

	// Write to JSON file - use same timestamp for both filename and runId
	timestamp := time.Now().UnixMilli()
	runData.RunID = fmt.Sprintf("run-%d", timestamp)
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

	// Use LastLap from AC as the authoritative time (set at moment of completion).
	// Falls back to the last CurrentLap sample, then wall clock elapsed.
	lastSample := state.telemetryBuffer[len(state.telemetryBuffer)-1]
	var finalLapTime float32
	if state.completedLapMs > 0 {
		finalLapTime = float32(state.completedLapMs) / 1000.0
	} else if lastSample.LapTime > 0 {
		finalLapTime = lastSample.LapTime
	} else {
		finalLapTime = float32(lastSample.Timestamp)
	}

	// RunID will be overwritten in saveRun with the same timestamp as the filename
	runID := fmt.Sprintf("run-%d", time.Now().UnixMilli())

	// Extract CarId and TrackId from last sample
	var carID, trackID string
	if state.lastCarID != 0 {
		carID = fmt.Sprintf("%d", state.lastCarID)
	}
	if state.lastTrackID != 0 {
		trackID = fmt.Sprintf("%d", state.lastTrackID)
	}

	return util.AutocrossRun{
		RunID:     runID,
		CourseID:  state.currentCourseID,
		Timestamp: time.Now().Format(time.RFC3339),
		LapTime:   finalLapTime,
		CarID:     carID,
		TrackID:   trackID,
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
