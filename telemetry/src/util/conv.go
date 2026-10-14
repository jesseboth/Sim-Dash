package util

import (
    "encoding/binary"
    "math"
)

// Float32frombytes converts bytes into a float32. NaN and infinity read as 0: they carry no
// telemetry value and JSON cannot hold them.
func Float32frombytes(bytes []byte) float32 {
    bits := binary.LittleEndian.Uint32(bytes)
    float := math.Float32frombits(bits)
    if math.IsNaN(float64(float)) || math.IsInf(float64(float), 0) {
        return 0
    }
    return float
}

// Float64frombytes converts 8 bytes (little-endian) to a float64
func Float64frombytes(b []byte) float64 {
	if len(b) < 8 {
		return 0 // or handle error
	}
	bits := uint64(b[0]) | uint64(b[1])<<8 | uint64(b[2])<<16 | uint64(b[3])<<24 |
		uint64(b[4])<<32 | uint64(b[5])<<40 | uint64(b[6])<<48 | uint64(b[7])<<56
	float := math.Float64frombits(bits)
	if math.IsNaN(float) || math.IsInf(float, 0) {
		return 0
	}
	return float
}
