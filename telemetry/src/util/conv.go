package util

import (
    "encoding/binary"
    "math"
)

// Float32frombytes converts bytes into a float32
func Float32frombytes(bytes []byte) float32 {
    bits := binary.LittleEndian.Uint32(bytes)
    float := math.Float32frombits(bits)
    return float
}