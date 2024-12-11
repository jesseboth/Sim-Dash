package util

// Telemetry struct represents a piece of telemetry as defined in the Forza data format (see the .dat files)
type Telemetry struct {
    Position    int
    Name        string
    DataType    string
    StartOffset int
    EndOffset   int
}