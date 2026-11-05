package game

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"sync"
	"time"

	"jesseboth/fdt/src/util"
)

// Frame is one game packet in the form that the recorder uses. Each game parser makes one.
type Frame struct {
	Timer      float32 // run timer from the game in seconds, 0 while stopped
	LastLap    float32 // time of the last completed run in seconds, 0 when unknown
	HasLastLap bool    // the game sets LastLap at the finish; a timer reset without it is a restart
	Progress   float32 // part of the stage that is driven (0..1), -1 when unknown
	CarID      int32
	TrackID    int32
	CarClass   string // class from the game, empty when the game sends none
	Cones      int
	Sample     util.TelemetrySample // the recorder sets Timestamp and LapTime
}

const (
	sampleInterval   = time.Second / 50       // runs keep at most 50 samples per second
	maxRunSamples    = 30 * 60 * 50           // 30 minutes at 50 Hz, for long rally stages
	launchSpeed      = 1.0                    // mph; below this the car is waiting to launch
	launchStillKeep  = 500 * time.Millisecond // standing time kept before the launch
	launchMaxLength  = 30 * time.Second       // longest launch kept
	timerFreeze      = 2 * time.Second        // a timer that does not change for this time has stopped
	finishedProgress = 0.98                   // a stage run with less progress did not finish
	rewindMin        = 1.0                    // s; a timer that goes back to this or more is a rewind, not a reset
	timerDrift       = 0.5                    // s; sample times follow the game timer when they differ by more
	lapTimeMatch     = 0.25                   // s; LastLap is the run time when it is this near the last timer
	minRunTime       = 5.0                    // s; a shorter run is a restart, not a run
	lastLapWait      = time.Second            // time for LastLap to change after a timer reset
	armedTimeout     = time.Hour              // armed with no game data for this time: disarm
)

// Recorder finds runs in the frames of any game and saves them for the armed course
type Recorder struct {
	mu    sync.Mutex
	game  string
	debug bool

	enabled    bool
	runActive  bool
	courseID   string
	runStarted time.Time // wall clock at timer 0
	buffer     []util.TelemetrySample
	prevTimer  float32 // -1 until the first frame after arming, so a run in progress is not recorded
	progress   float32
	cones      int
	lastPacket time.Time
	armedAt    time.Time // when the watch first saw the recorder armed; zero while disarmed

	freezeValue float32
	freezeTime  time.Time

	lastCarID   int32
	lastTrackID int32
	lastClass   string

	launchBuffer []util.TelemetrySample // samples from the launch, before the timer starts
	launchTimes  []time.Time

	pending *endedRun // run after a timer reset, until LastLap shows a finish or lastLapWait ends
}

// endedRun is a run that is ready to save
type endedRun struct {
	samples    []util.TelemetrySample
	finalTimer float32
	cones      int
	deadline   time.Time
}

// NewRecorder makes a recorder for a game. It also watches for a game that stops sending at the finish.
func NewRecorder(game string, debug bool) *Recorder {
	r := &Recorder{
		game:      game,
		debug:     debug,
		buffer:    make([]util.TelemetrySample, 0, 4096),
		prevTimer: -1,
		progress:  -1,
	}
	go r.watch()
	return r
}

// Update gives one frame to the recorder
func (r *Recorder) Update(f Frame) {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now()
	r.lastPacket = now
	if f.CarID != 0 {
		r.lastCarID = f.CarID
	}
	if f.TrackID != 0 && f.TrackID != r.lastTrackID {
		r.lastTrackID = f.TrackID
		util.UpdateTrackID(f.TrackID)
	}
	if f.CarClass != "" {
		r.lastClass = f.CarClass
	}
	if !r.syncArmed() {
		return
	}
	r.checkPending(f.LastLap, now)

	timer := f.Timer
	f.Sample.LapTime = timer

	// The timer went back to the start: the finish line, or the driver restarted.
	// A smaller step back is a rewind, and the samples follow the timer below.
	if r.prevTimer > 0 && timer < r.prevTimer && timer < rewindMin {
		if r.runActive {
			r.endReset(f, now)
		}
		r.prevTimer = 0
	}

	// Time 0 is where the timer started; the launch before it has negative times
	if !r.runActive && timer > 0 && r.prevTimer == 0 {
		r.startRun(timer, now)
	}

	r.prevTimer = timer
	if r.runActive {
		r.progress = f.Progress
		r.cones = f.Cones // the plugin count stops at the finish, so its last value is the count of the run
	}

	if !r.runActive {
		r.bufferLaunch(f.Sample, now)
		return
	}

	// Pause and rewind: sample times follow the game timer, and samples after it are removed
	if timer > 0 && math.Abs(now.Sub(r.runStarted).Seconds()-float64(timer)) > timerDrift {
		r.runStarted = now.Add(-time.Duration(float64(timer) * float64(time.Second)))
		r.dropAfter(float64(timer))
	}

	f.Sample.Timestamp = now.Sub(r.runStarted).Seconds()
	if n := len(r.buffer); n == 0 || sampleSlot(f.Sample.Timestamp) > sampleSlot(r.buffer[n-1].Timestamp) {
		r.buffer = append(r.buffer, f.Sample)
	}
	util.UpdateRecordingElapsed(now.Sub(r.runStarted).Seconds())

	// End of a stage
	if f.Progress >= 1 {
		r.endRun(f.LastLap, timer, "stage complete")
		return
	}

	// The timer stopped. Before the end of a stage, this is a pause.
	if timer != r.freezeValue {
		r.freezeValue = timer
		r.freezeTime = now
	} else if timer > 0 && now.Sub(r.freezeTime) > timerFreeze && !r.stageUnfinished() {
		r.trimAfterFreeze()
		r.endRun(f.LastLap, timer, "timer stopped")
		return
	}

	if len(r.buffer) >= maxRunSamples {
		r.endDNF(timer, "buffer full")
	}
}

// syncArmed follows the armed state of the API. It returns false while not armed.
func (r *Recorder) syncArmed() bool {
	api := util.GetRecordingState()
	switch {
	case api.IsRecording && !r.enabled:
		r.enabled = true
		r.courseID = api.CourseID
		r.reset()
		r.prevTimer = -1
		if r.debug {
			log.Printf("Recorder armed for course: %s", r.courseID)
		}
	case api.IsRecording && api.CourseID != r.courseID:
		// Armed again for another course: runs go to the course now selected
		r.courseID = api.CourseID
	case !api.IsRecording && r.enabled:
		// Disarmed: discard the run in progress
		r.enabled = false
		r.reset()
		r.pending = nil
		if r.debug {
			log.Println("Recorder disarmed, run in progress discarded")
		}
	}
	return r.enabled
}

func (r *Recorder) startRun(timer float32, now time.Time) {
	r.runActive = true
	r.runStarted = now.Add(-time.Duration(float64(timer) * float64(time.Second)))
	r.buffer = r.buffer[:0]
	for i, sample := range r.launchBuffer {
		sample.Timestamp = r.launchTimes[i].Sub(r.runStarted).Seconds()
		r.buffer = append(r.buffer, sample)
	}
	r.clearLaunch()
	r.cones = 0
	r.progress = -1
	r.freezeValue = timer
	r.freezeTime = now
	if r.debug {
		log.Println("Run started - timer began")
	}
}

// endReset ends the run at a timer reset. A finished stage, or a LastLap that agrees with the
// timer, is a finish. A stage that did not finish is a DNF. In a game that sets LastLap at the
// finish, the run waits for LastLap; without it, the run is a DNF.
func (r *Recorder) endReset(f Frame, now time.Time) {
	final := r.prevTimer
	switch {
	case r.stageUnfinished():
		r.endDNF(final, "stage restarted")
	case r.progress >= 0 || !f.HasLastLap || lapTimeAgrees(f.LastLap, final):
		r.endRun(f.LastLap, final, "timer reset")
	case final < minRunTime:
		r.discard(final, "timer reset")
	default:
		r.pending = &endedRun{
			samples:    append([]util.TelemetrySample(nil), r.buffer...),
			finalTimer: final,
			cones:      r.cones,
			deadline:   now.Add(lastLapWait),
		}
		r.reset()
		util.NotifyRunDiscarded()
	}
}

// checkPending saves the run after a timer reset: a finish when LastLap agrees, else a DNF after the wait
func (r *Recorder) checkPending(lastLap float32, now time.Time) {
	p := r.pending
	if p == nil {
		return
	}
	if lapTimeAgrees(lastLap, p.finalTimer) {
		r.pending = nil
		r.save(p.samples, lastLap, p.cones, true, "timer reset")
	} else if now.After(p.deadline) {
		r.pending = nil
		r.save(p.samples, p.finalTimer, p.cones, false, "restart")
	}
}

func lapTimeAgrees(lastLap, timer float32) bool {
	return lastLap > 0 && math.Abs(float64(lastLap-timer)) < lapTimeMatch
}

// endRun saves a finished run. LastLap is the time when it agrees with the timer.
func (r *Recorder) endRun(lastLap, finalTimer float32, reason string) {
	if finalTimer < minRunTime {
		r.discard(finalTimer, reason)
		return
	}
	lapTime := finalTimer
	if lapTimeAgrees(lastLap, finalTimer) {
		lapTime = lastLap
	}
	r.save(r.buffer, lapTime, r.cones, true, reason)
	r.reset()
}

// endDNF saves the run up to where it stopped, as not finished (isValid false)
func (r *Recorder) endDNF(finalTimer float32, reason string) {
	if finalTimer < minRunTime {
		r.discard(finalTimer, reason)
		return
	}
	r.save(r.buffer, finalTimer, r.cones, false, reason)
	r.reset()
}

func (r *Recorder) discard(finalTimer float32, reason string) {
	if r.debug {
		log.Printf("Run discarded - %s at %.1f s", reason, finalTimer)
	}
	r.reset()
	util.NotifyRunDiscarded()
}

// save writes a run and tells the page
func (r *Recorder) save(samples []util.TelemetrySample, lapTime float32, cones int, finished bool, reason string) {
	if r.debug {
		log.Printf("Run saved - %s, finished %v, %.3f s", reason, finished, lapTime)
	}
	r.saveRun(samples, lapTime, cones, finished)
	util.NotifyRunSaved()
}

// stageUnfinished is true when the game gives the stage progress and the car is not at the end
func (r *Recorder) stageUnfinished() bool {
	return r.progress >= 0 && r.progress < finishedProgress
}

func (r *Recorder) checkArmedTimeout() {
	if !util.GetRecordingState().IsRecording {
		r.armedAt = time.Time{}
		return
	}
	if r.armedAt.IsZero() {
		r.armedAt = time.Now()
	}
	last := r.lastPacket
	if r.armedAt.After(last) {
		last = r.armedAt
	}
	if !r.runActive && time.Since(last) > armedTimeout {
		util.StopRecording()
		r.armedAt = time.Time{}
		log.Printf("Recorder disarmed: no game data for %v", armedTimeout)
	}
}

func (r *Recorder) reset() {
	r.runActive = false
	r.buffer = r.buffer[:0]
	r.progress = -1
	r.clearLaunch()
}

// watch ends a finished stage when the game stops sending packets at the finish, and
// disarms a recorder that gets no game data for armedTimeout (a forgotten session)
func (r *Recorder) watch() {
	for range time.Tick(500 * time.Millisecond) {
		r.mu.Lock()
		r.checkArmedTimeout()
		if r.enabled {
			r.checkPending(0, time.Now())
		}
		if r.runActive && r.progress >= finishedProgress && time.Since(r.lastPacket) > timerFreeze &&
			util.GetRecordingState().IsRecording {
			var timer float32
			if n := len(r.buffer); n > 0 {
				timer = r.buffer[n-1].LapTime
			}
			r.endRun(0, timer, "packets stopped")
		}
		r.mu.Unlock()
	}
}

// sampleSlot is the sampleInterval time slot of a run time. One sample is kept per slot:
// packets arrive once per game frame, so their spacing is uneven and a minimum gap
// between kept samples would drop many of them.
func sampleSlot(t float64) int64 {
	return int64(math.Floor(t / sampleInterval.Seconds()))
}

// bufferLaunch keeps the samples since the car last stood still, so a run includes its launch
func (r *Recorder) bufferLaunch(sample util.TelemetrySample, now time.Time) {
	if n := len(r.launchTimes); n > 0 && now.UnixNano()/int64(sampleInterval) == r.launchTimes[n-1].UnixNano()/int64(sampleInterval) {
		return
	}

	// Standing still: keep only a short standing time, so the launch starts from rest
	keepFrom := now.Add(-launchMaxLength)
	if sample.Speed < launchSpeed {
		keepFrom = now.Add(-launchStillKeep)
	}
	drop := 0
	for drop < len(r.launchTimes) && r.launchTimes[drop].Before(keepFrom) {
		drop++
	}
	r.launchBuffer = append(r.launchBuffer[drop:], sample)
	r.launchTimes = append(r.launchTimes[drop:], now)
}

func (r *Recorder) clearLaunch() {
	r.launchBuffer = nil
	r.launchTimes = nil
}

// dropAfter removes the samples after a run time
func (r *Recorder) dropAfter(t float64) {
	keep := len(r.buffer)
	for keep > 0 && r.buffer[keep-1].Timestamp > t {
		keep--
	}
	r.buffer = r.buffer[:keep]
}

// trimAfterFreeze removes the samples after the timer stopped, so the run ends at the finish
func (r *Recorder) trimAfterFreeze() {
	last := len(r.buffer) - 1
	for last > 0 && r.buffer[last-1].LapTime == r.buffer[last].LapTime {
		last--
	}
	r.buffer = r.buffer[:last+1]
}

// roundTo rounds v to the given number of decimals, to keep run files small
func roundTo(v float32, decimals int) float32 {
	p := math.Pow(10, float64(decimals))
	return float32(math.Round(float64(v)*p) / p)
}

// absFloat32 returns the absolute value of a float32
func absFloat32(x float32) float32 {
	return float32(math.Abs(float64(x)))
}

// saveRun saves the recorded run to disk
func (r *Recorder) saveRun(samples []util.TelemetrySample, lapTime float32, cones int, finished bool) {
	if len(samples) == 0 {
		log.Println("No telemetry data to save")
		return
	}

	runData := r.prepareRunData(samples, lapTime, cones, finished)

	runDir := filepath.Join("data", "autocross", r.courseID, "runs")
	if err := os.MkdirAll(runDir, 0755); err != nil {
		log.Printf("Error creating run directory: %v", err)
		return
	}

	// The file name and the run ID use the same timestamp
	timestamp := time.Now().UnixMilli()
	runData.RunID = fmt.Sprintf("run-%d", timestamp)
	filename := filepath.Join(runDir, fmt.Sprintf("run-%d.json", timestamp))

	// Compact JSON: run files hold tens of thousands of samples. The file is written only
	// when the data encodes, so a failed save leaves no empty run file.
	encoded, err := json.Marshal(runData)
	if err != nil {
		log.Printf("Error encoding run data: %v", err)
		return
	}
	if err := os.WriteFile(filename, encoded, 0644); err != nil {
		log.Printf("Error writing run file: %v", err)
		return
	}

	if r.debug {
		log.Printf("Run saved: %s (%.3f seconds, %d samples)", filename, runData.LapTime, len(samples))
	}

	if finished {
		updateTop10(r.courseID, runData, r.debug)
	}
}

// prepareRunData converts the buffered samples into the run format
// A run that did not finish has isValid false; its lapTime is the time where it stopped.
func (r *Recorder) prepareRunData(samples []util.TelemetrySample, lapTime float32, cones int, finished bool) util.AutocrossRun {
	n := len(samples)
	timestamps := make([]float64, n)
	brake := make([]float32, n)
	accel := make([]float32, n)
	accelX := make([]float32, n)
	accelY := make([]float32, n)
	speed := make([]float32, n)
	posX := make([]float32, n)
	posY := make([]float32, n)
	posZ := make([]float32, n)
	steer := make([]float32, n)
	clutch := make([]float32, n)
	rpm := make([]float32, n)
	gear := make([]int32, n)
	wheelSpeed := util.NewWheelChannel(n)
	slipAngle := util.NewWheelChannel(n)
	slipRatio := util.NewWheelChannel(n)
	load := util.NewWheelChannel(n)
	suspTravel := util.NewWheelChannel(n)
	yawRate := make([]float32, n)
	bodySlip := make([]float32, n)

	var maxSpeed, maxLatG, maxLongG float32

	for i, sample := range samples {
		timestamps[i] = sample.Timestamp
		brake[i] = sample.Brake
		accel[i] = sample.Accel
		accelX[i] = sample.AccelX
		accelY[i] = sample.AccelY
		speed[i] = sample.Speed
		posX[i] = sample.PosX
		posY[i] = sample.PosY
		posZ[i] = sample.PosZ
		steer[i] = sample.Steer
		clutch[i] = sample.Clutch
		rpm[i] = sample.Rpm
		gear[i] = sample.Gear
		wheelSpeed.Set(i, sample.WheelSpeed)
		slipAngle.Set(i, sample.SlipAngle)
		slipRatio.Set(i, sample.SlipRatio)
		load.Set(i, sample.Load)
		suspTravel.Set(i, sample.SuspTravel)
		yawRate[i] = sample.YawRate
		bodySlip[i] = sample.BodySlip

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

	if lapTime <= 0 {
		lapTime = float32(samples[n-1].Timestamp)
	}

	apiState := util.GetRecordingState()

	var carID, trackID string
	if r.lastCarID != 0 {
		carID = fmt.Sprintf("%d", r.lastCarID)
	}
	if r.lastTrackID != 0 {
		trackID = fmt.Sprintf("%d", r.lastTrackID)
	}
	carClass := apiState.CarClass
	if r.lastClass != "" {
		carClass = r.lastClass
	}

	return util.AutocrossRun{
		RunID:     fmt.Sprintf("run-%d", time.Now().UnixMilli()),
		CourseID:  r.courseID,
		Timestamp: time.Now().Format(time.RFC3339),
		Game:      r.game,
		LapTime:   lapTime,
		CarID:     carID,
		TrackID:   trackID,
		Cones:     cones,
		Driver:    apiState.Driver,
		Car:       apiState.Car,
		CarClass:  carClass,
		IsValid:   finished,
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
			Steer:      steer,
			Clutch:     clutch,
			Rpm:        rpm,
			Gear:       gear,
			WheelSpeed: wheelSpeed,
			SlipAngle:  slipAngle,
			SlipRatio:  slipRatio,
			Load:       load,
			SuspTravel: suspTravel,
			YawRate:    yawRate,
			BodySlip:   bodySlip,
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

	var top10 []util.Top10Entry
	if data, err := os.ReadFile(top10File); err == nil {
		json.Unmarshal(data, &top10)
	}

	top10 = append(top10, util.Top10Entry{
		RunID:        newRun.RunID,
		LapTime:      newRun.LapTime,
		Cones:        newRun.Cones,
		AdjustedTime: newRun.LapTime + float32(newRun.Cones)*2.0,
		Timestamp:    newRun.Timestamp,
		CarID:        newRun.CarID,
	})

	// Sort by adjusted time
	for i := 0; i < len(top10); i++ {
		for j := i + 1; j < len(top10); j++ {
			if top10[j].AdjustedTime < top10[i].AdjustedTime {
				top10[i], top10[j] = top10[j], top10[i]
			}
		}
	}
	if len(top10) > 10 {
		top10 = top10[:10]
	}

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

// stageID is the track ID of a rally stage: its length in whole metres. 0 when the length is unknown.
// A stage and its reverse can have the same length, and then the same ID.
func stageID(length float64) int32 {
	if length <= 0 {
		return 0
	}
	return int32(math.Round(length))
}

// mph converts m/s to mph
func mph(v float32) float32 {
	return v * 2.23694
}

// GameClasses are the class names of the game, in the order of the class number in the packet
var GameClasses []string

// gravity in m/s², to convert accelerations to G
const gravity = 9.81
