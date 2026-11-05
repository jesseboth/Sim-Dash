package util

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"
)

const armedStateFile = "data/autocross/armed.json"

// armedState is the subset of state persisted to disk
type armedState struct {
	IsArmed  bool   `json:"isArmed"`
	CourseID string `json:"courseId"`
	Driver   string `json:"driver"`
	Car      string `json:"car"`
	CarClass string `json:"carClass"`
	Game     string `json:"game"`
}

// Course IDs are used as directory names, so only plain names are allowed
var validCourseID = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

var (
	recordingMutex sync.RWMutex
	recordingState = RecordingState{}
)

// SetRecorderGame sets the game of this telemetry process. Call it before ServeJson.
func SetRecorderGame(game string, canRecord bool) {
	recordingMutex.Lock()
	defer recordingMutex.Unlock()
	recordingState.Game = game
	recordingState.CanRecord = canRecord
}

// loadArmedState restores armed state from disk on startup.
// The recorder stays armed only for the same game: after a game change the user must press Start again.
func loadArmedState() {
	data, err := os.ReadFile(armedStateFile)
	if err != nil {
		return // no saved state, start disarmed
	}
	var s armedState
	if err := json.Unmarshal(data, &s); err != nil {
		return
	}
	recordingState.Driver = s.Driver
	recordingState.Car = s.Car
	recordingState.CarClass = s.CarClass
	// The car and the class belong to the game
	if s.Game != recordingState.Game {
		log.Printf("Game changed from %s to %s, recorder disarmed", s.Game, recordingState.Game)
		recordingState.Car = ""
		recordingState.CarClass = ""
		saveArmedState()
		return
	}
	if s.IsArmed && recordingState.CanRecord && validCourseID.MatchString(s.CourseID) {
		recordingState.IsRecording = true
		recordingState.CourseID = s.CourseID
		log.Printf("Restored armed state for course: %s", s.CourseID)
	}
}

// saveArmedState writes the armed state, the driver and the car to disk. Hold recordingMutex.
func saveArmedState() {
	os.MkdirAll(filepath.Dir(armedStateFile), 0755)
	courseID := ""
	if recordingState.IsRecording {
		courseID = recordingState.CourseID
	}
	data, _ := json.Marshal(armedState{
		IsArmed:  recordingState.IsRecording,
		CourseID: courseID,
		Driver:   recordingState.Driver,
		Car:      recordingState.Car,
		CarClass: recordingState.CarClass,
		Game:     recordingState.Game,
	})
	os.WriteFile(armedStateFile, data, 0644)
}

// SetupAutocrossRoutes registers autocross API endpoints
func SetupAutocrossRoutes() {
	loadArmedState()
	http.HandleFunc("/autocross/recording/start", handleStartRecording)
	http.HandleFunc("/autocross/recording/stop", handleStopRecording)
	http.HandleFunc("/autocross/recording/status", handleRecordingStatus)
	http.HandleFunc("/autocross/recording/driver", handleSetDriver)
	log.Println("Autocross API routes registered")
}

// handleStartRecording handles POST requests to start recording
func handleStartRecording(w http.ResponseWriter, r *http.Request) {
	enableCors(&w)

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		CourseID string `json:"courseId"`
	}

	err := json.NewDecoder(r.Body).Decode(&req)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request body",
		})
		return
	}

	if !validCourseID.MatchString(req.CourseID) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid courseId",
		})
		return
	}

	recordingMutex.Lock()
	defer recordingMutex.Unlock()

	if !recordingState.CanRecord {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "This game sends no run timer, so the recorder cannot find runs",
		})
		return
	}

	// Allow re-arming (e.g. different course) — just update state
	recordingState.IsRecording = true
	recordingState.CourseID = req.CourseID
	recordingState.Elapsed = 0
	saveArmedState()

	log.Printf("Recording started for course: %s", req.CourseID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

// handleStopRecording handles POST requests to stop recording
func handleStopRecording(w http.ResponseWriter, r *http.Request) {
	enableCors(&w)

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	recordingMutex.Lock()
	defer recordingMutex.Unlock()

	// Always disarm, even if already stopped (handles out-of-sync state)
	recordingState.IsRecording = false
	recordingState.RunActive = false
	recordingState.Staged = false
	recordingState.Elapsed = 0
	saveArmedState()

	log.Println("Recording stopped by user")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

// handleSetDriver sets the driver, the car and the class that the recorder gives to new runs
func handleSetDriver(w http.ResponseWriter, r *http.Request) {
	enableCors(&w)

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Driver   string `json:"driver"`
		Car      string `json:"car"`
		CarClass string `json:"carClass"`
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request body",
		})
		return
	}

	recordingMutex.Lock()
	recordingState.Driver = req.Driver
	recordingState.Car = req.Car
	recordingState.CarClass = req.CarClass
	saveArmedState()
	recordingMutex.Unlock()

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

// handleRecordingStatus handles GET requests for recording status
func handleRecordingStatus(w http.ResponseWriter, r *http.Request) {
	enableCors(&w)

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	recordingMutex.RLock()
	state := recordingState
	recordingMutex.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(state)
}

// GetRecordingState returns the current recording state (for game loop)
func GetRecordingState() RecordingState {
	recordingMutex.RLock()
	defer recordingMutex.RUnlock()
	return recordingState
}

// UpdateRecordingElapsed updates the elapsed time and run-active flag
func UpdateRecordingElapsed(elapsed float64) {
	recordingMutex.Lock()
	defer recordingMutex.Unlock()
	recordingState.Elapsed = elapsed
	recordingState.RunActive = true
}

// NotifyRunSaved signals that an auto-detected run was saved
func NotifyRunSaved() {
	recordingMutex.Lock()
	defer recordingMutex.Unlock()
	recordingState.RunSavedAt = time.Now().UnixMilli()
	recordingState.RunActive = false
	recordingState.Elapsed = 0
}

// UpdateTrackID sets the live track ID, so the page can move recording to the course of a new track
func UpdateTrackID(id int32) {
	recordingMutex.Lock()
	defer recordingMutex.Unlock()
	recordingState.TrackID = id
}

// SetStaged sets whether the car stands at the start, ready for a run
func SetStaged(staged bool) {
	recordingMutex.Lock()
	defer recordingMutex.Unlock()
	recordingState.Staged = staged
}

// NotifyRunDiscarded signals that the run in progress was not saved
func NotifyRunDiscarded() {
	recordingMutex.Lock()
	defer recordingMutex.Unlock()
	recordingState.RunActive = false
	recordingState.Elapsed = 0
}

// StopRecording stops the recording (called by game loop on user stop)
func StopRecording() {
	recordingMutex.Lock()
	defer recordingMutex.Unlock()
	recordingState.IsRecording = false
	recordingState.RunActive = false
	recordingState.Elapsed = 0
	saveArmedState()
}
