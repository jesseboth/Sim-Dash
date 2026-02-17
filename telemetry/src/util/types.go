package util

// Telemetry struct represents a piece of telemetry as defined in the Forza data format (see the .dat files)
type Telemetry struct {
    Position    int
    Name        string
    DataType    string
    StartOffset int
    EndOffset   int
}

// Autocross recording types

// TelemetrySample represents a single telemetry sample during recording
type TelemetrySample struct {
    Timestamp float64 `json:"timestamp"`
    Brake     float32 `json:"brake"`
    Accel     float32 `json:"accel"`
    AccelX    float32 `json:"accelX"`
    AccelY    float32 `json:"accelY"`
    Speed     float32 `json:"speed"`
    PosX      float32 `json:"posX"`
    PosY      float32 `json:"posY"`
    PosZ      float32 `json:"posZ"`
    LapTime   float32 `json:"lapTime"`
}

// AutocrossRun represents a complete autocross run
type AutocrossRun struct {
    RunID      string              `json:"runId"`
    CourseID   string              `json:"courseId"`
    Timestamp  string              `json:"timestamp"`
    LapTime    float32             `json:"lapTime"`
    CarID      string              `json:"carId"`
    TrackID    string              `json:"trackId"`
    Cones      int                 `json:"cones"`
    Name       string              `json:"name,omitempty"`
    IsValid    bool                `json:"isValid"`
    Telemetry  AutocrossTelemetry  `json:"telemetry"`
    Statistics AutocrossStatistics `json:"statistics"`
}

// AutocrossTelemetry holds all telemetry arrays
type AutocrossTelemetry struct {
    Timestamps []float64 `json:"timestamps"`
    Brake      []float32 `json:"brake"`
    Accel      []float32 `json:"accel"`
    AccelX     []float32 `json:"accelX"`
    AccelY     []float32 `json:"accelY"`
    Speed      []float32 `json:"speed"`
    PosX       []float32 `json:"posX"`
    PosY       []float32 `json:"posY"`
    PosZ       []float32 `json:"posZ"`
}

// AutocrossStatistics holds calculated statistics
type AutocrossStatistics struct {
    MaxSpeed float32 `json:"maxSpeed"`
    MaxLatG  float32 `json:"maxLatG"`
    MaxLongG float32 `json:"maxLongG"`
}

// RecordingState tracks the current recording state
type RecordingState struct {
    IsRecording bool    `json:"isRecording"`
    CourseID    string  `json:"courseId"`
    Elapsed     float64 `json:"elapsed"`
}

// Top10Entry represents a top 10 run entry
type Top10Entry struct {
    RunID        string  `json:"runId"`
    LapTime      float32 `json:"lapTime"`
    Cones        int     `json:"cones"`
    AdjustedTime float32 `json:"adjustedTime"`
    Timestamp    string  `json:"timestamp"`
    CarID        string  `json:"carId"`
}