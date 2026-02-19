package util

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"
)

var (
	recordingMutex sync.RWMutex
	recordingState = RecordingState{
		IsRecording: false,
		CourseID:    "",
		Elapsed:     0,
	}
)

// SetupAutocrossRoutes registers autocross API endpoints
func SetupAutocrossRoutes() {
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

	if recordingState.IsRecording {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Already recording",
		})
		return
	}

	// Signal to game loop to start recording
	recordingState.IsRecording = true
	recordingState.CourseID = req.CourseID
	recordingState.Elapsed = 0

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

	if !recordingState.IsRecording {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Not recording",
		})
		return
	}

	// Signal to game loop to stop recording
	recordingState.IsRecording = false
	recordingState.Elapsed = 0

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
}
