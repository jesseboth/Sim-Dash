package game

import (
	"encoding/binary"
	"encoding/json"
	"log"
	"math"
	"net"

	"jesseboth/fdt/src/util"
)

// Bytes at the end of the AC packet that older plugins do not send (YawRate, BodySlipAngle, Cones).
// Those packets are still accepted; the missing values read as 0.
const acNewFieldsLength = 12

// AssettoLoop is the main loop for Assetto Corsa telemetry
func AssettoLoop(game string, conn *net.UDPConn, telemArray []util.Telemetry, totalLength int, debug bool) {
	log.Println("Starting Assetto Corsa Telemetry")

	recorder := NewRecorder(game, debug)
	for {
		AssettoReadData(conn, telemArray, totalLength, recorder, debug)
	}
}

// AssettoReadData reads UDP packet and processes telemetry
func AssettoReadData(conn *net.UDPConn, telemArray []util.Telemetry, totalLength int, recorder *Recorder, debug bool) {
	buffer := make([]byte, 1500)

	n, addr, err := conn.ReadFromUDP(buffer)
	if err != nil {
		log.Fatal("Error reading UDP data:", err, addr)
	} else if n < totalLength-acNewFieldsLength {
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

	// Fields an older plugin does not send read as 0
	packet := make([]byte, totalLength)
	copy(packet, buffer[:n])

	// Parse packet into typed maps
	f32map := make(map[string]float32)
	u8map := make(map[string]uint8)
	s32map := make(map[string]int32)

	for i, T := range telemArray {
		data := packet[T.StartOffset:T.EndOffset]

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

	recorder.Update(Frame{
		Timer:      float32(s32map["CurrentLap"]) / 1000,
		LastLap:    float32(s32map["LastLap"]) / 1000,
		HasLastLap: true,
		Progress:   -1,
		CarID:      s32map["CarId"],
		TrackID:    s32map["TrackId"],
		Cones:      int(s32map["Cones"]),
		Sample:     acSample(f32map, s32map),
	})
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

	// AC gear encoding: R=-1, N=0, 1st=1, 2nd=2...
	combinedMap["GearNeutral"] = int32(0)
	combinedMap["GearReverse"] = int32(-1)

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

// acSample makes a run sample from the AC packet
func acSample(f32map map[string]float32, s32map map[string]int32) util.TelemetrySample {
	sample := util.TelemetrySample{
		Brake:    f32map["Brake"],
		Accel:    f32map["Accel"],
		AccelX:   roundTo(f32map["AccelerationX"], 2), // Lateral G (left/right)
		AccelY:   roundTo(f32map["AccelerationZ"], 2), // Longitudinal G (accel/brake)
		Speed:    mph(f32map["Speed"]),
		PosX:     f32map["PositionX"], // X coordinate
		PosY:     f32map["PositionZ"], // Z coordinate for top-down map - FIXED from PositionY
		PosZ:     f32map["PositionY"], // Y coordinate (elevation)
		Steer:    roundTo(f32map["Steer"], 2),
		Clutch:   roundTo(f32map["Clutch"], 3),
		Rpm:      float32(math.Round(float64(f32map["CurrentEngineRpm"]))),
		Gear:     s32map["Gear"],
		YawRate:  roundTo(f32map["YawRate"], 1),
		BodySlip: roundTo(f32map["BodySlipAngle"], 2),
	}

	for i, wheel := range wheelNames {
		radius := f32map["TyreRadius"+wheel]
		omega := f32map["WheelRotationSpeed"+wheel] // rad/s
		sample.WheelSpeed[i] = roundTo(absFloat32(omega*radius)*2.23694, 1)
		sample.SlipAngle[i] = roundTo(f32map["TireSlipAngle"+wheel], 2)
		sample.SlipRatio[i] = roundTo(f32map["TireSlipRatio"+wheel], 3)
		sample.Load[i] = roundTo(f32map["WheelLoad"+wheel]/9.81, 0)
		sample.SuspTravel[i] = roundTo(f32map["SuspensionTravelMeters"+wheel]*1000, 1)
	}
	return sample
}

// Wheel name suffixes in the AC packet, in FL, FR, RL, RR order
var wheelNames = [4]string{"FrontLeft", "FrontRight", "RearLeft", "RearRight"}
