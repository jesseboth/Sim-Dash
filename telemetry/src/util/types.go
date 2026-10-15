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
    Steer     float32
    Clutch    float32
    Rpm       float32
    Gear      int32
    YawRate   float32 // deg/s
    BodySlip  float32 // deg, angle between heading and direction of travel
    // Per wheel, in FL, FR, RL, RR order
    WheelSpeed [4]float32 // mph
    SlipAngle  [4]float32
    SlipRatio  [4]float32
    Load       [4]float32 // kg
    SuspTravel [4]float32 // mm
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
    Driver     string              `json:"driver,omitempty"`
    Car        string              `json:"car,omitempty"`
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
    Steer      []float32 `json:"steer,omitempty"`
    Clutch     []float32 `json:"clutch,omitempty"`
    Rpm        []float32 `json:"rpm,omitempty"`
    Gear       []int32   `json:"gear,omitempty"`
    YawRate    []float32 `json:"yawRate,omitempty"`
    BodySlip   []float32 `json:"bodySlip,omitempty"`
    WheelSpeed *WheelChannel `json:"wheelSpeed,omitempty"`
    SlipAngle  *WheelChannel `json:"slipAngle,omitempty"`
    SlipRatio  *WheelChannel `json:"slipRatio,omitempty"`
    Load       *WheelChannel `json:"load,omitempty"`
    SuspTravel *WheelChannel `json:"suspTravel,omitempty"`
}

// WheelChannel holds one telemetry channel for each wheel
type WheelChannel struct {
    FL []float32 `json:"fl"`
    FR []float32 `json:"fr"`
    RL []float32 `json:"rl"`
    RR []float32 `json:"rr"`
}

// NewWheelChannel makes a WheelChannel with n samples per wheel
func NewWheelChannel(n int) *WheelChannel {
    return &WheelChannel{
        FL: make([]float32, n),
        FR: make([]float32, n),
        RL: make([]float32, n),
        RR: make([]float32, n),
    }
}

// Set stores the four wheel values of sample i
func (w *WheelChannel) Set(i int, v [4]float32) {
    w.FL[i], w.FR[i], w.RL[i], w.RR[i] = v[0], v[1], v[2], v[3]
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
    RunActive   bool    `json:"runActive"`
    CourseID    string  `json:"courseId"`
    Elapsed     float64 `json:"elapsed"`
    RunSavedAt  int64   `json:"runSavedAt"` // unix ms, increments each time a run is auto-saved
    Driver      string  `json:"driver"`     // given to each new run
    Car         string  `json:"car"`        // given to each new run; empty when the game sends a car ID
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