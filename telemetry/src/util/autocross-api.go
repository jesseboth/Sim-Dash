package util

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const armedStateFile = "data/autocross/armed.json"

// armedState is the subset of state persisted to disk
type armedState struct {
	IsArmed  bool   `json:"isArmed"`
	CourseID string `json:"courseId"`
}

var (
	recordingMutex sync.RWMutex
	recordingState = RecordingState{}
)

// loadArmedState restores armed state from disk on startup
func loadArmedState() {
	data, err := os.ReadFile(armedStateFile)
	if err != nil {
		return // no saved state, start disarmed
	}
	var s armedState
	if err := json.Unmarshal(data, &s); err != nil {
		return
	}
	if s.IsArmed && s.CourseID != "" {
		recordingState.IsRecording = true
		recordingState.CourseID = s.CourseID
		log.Printf("Restored armed state for course: %s", s.CourseID)
	}
}

// saveArmedState writes the armed/disarmed state to disk
func saveArmedState(armed bool, courseID string) {
	os.MkdirAll(filepath.Dir(armedStateFile), 0755)
	data, _ := json.Marshal(armedState{IsArmed: armed, CourseID: courseID})
	os.WriteFile(armedStateFile, data, 0644)
}

// SetupAutocrossRoutes registers autocross API endpoints
func SetupAutocrossRoutes() {
	loadArmedState()
	http.HandleFunc("/autocross/recording/start", handleStartRecording)
	http.HandleFunc("/autocross/recording/stop", handleStopRecording)
	http.HandleFunc("/autocross/recording/status", handleRecordingStatus)
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

	recordingMutex.Lock()
	defer recordingMutex.Unlock()

	// Allow re-arming (e.g. different course) — just update state
	recordingState.IsRecording = true
	recordingState.CourseID = req.CourseID
	recordingState.Elapsed = 0
	saveArmedState(true, req.CourseID)

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
	recordingState.Elapsed = 0
	saveArmedState(false, "")

	log.Println("Recording stopped by user")

	w.Header().Set("Content-Type", "application/json")
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

// StopRecording stops the recording (called by game loop on user stop)
func StopRecording() {
	recordingMutex.Lock()
	defer recordingMutex.Unlock()
	recordingState.IsRecording = false
	recordingState.RunActive = false
	recordingState.Elapsed = 0
	saveArmedState(false, "")
}
