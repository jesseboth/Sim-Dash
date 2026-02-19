package util

import (
    "log"
    "net"
    "net/http"
    "sync"
    "time"
)

var (
        mu          sync.Mutex
        jsonData    string
        lastUpdated time.Time
        staleTime   = 5 * time.Second // mark stale if no update in 5s
)

const jsonServerPort = ":8888"

func responder(w http.ResponseWriter, r *http.Request) {
    switch r.Method {
    case "GET":
        enableCors(&w)

        mu.Lock()
        data := jsonData
        age := time.Since(lastUpdated)
        mu.Unlock()

        if age > staleTime || data == "" {
            data = "null" // or "{}" if you prefer empty JSON
        }

        w.Write([]byte(data))
    default:
        w.WriteHeader(http.StatusMethodNotAllowed)
        log.Printf("Not supported.")
    }
}

func ServeJson() {
    http.HandleFunc("/telemetry", responder)
    SetupAutocrossRoutes()

    log.Printf("JSON data at http://%s%s\n", GetOutboundIP(), jsonServerPort)
    log.Fatal(http.ListenAndServe(jsonServerPort, nil))
}

// GetOutboundIP finds preferred outbound IP of this machine
func GetOutboundIP() net.IP {
    conn, err := net.Dial("udp", "1.2.3.4:4321") // dummy address to determine interface
    if err != nil {
        log.Fatal(err)
    }
    defer conn.Close()

    localAddr := conn.LocalAddr().(*net.UDPAddr)
    return localAddr.IP
}

// SetJson updates the telemetry JSON and timestamps it
func SetJson(str string) {
    mu.Lock()
    defer mu.Unlock()
    jsonData = str
    lastUpdated = time.Now()
}

func enableCors(w *http.ResponseWriter) {
    (*w).Header().Set("Access-Control-Allow-Origin", "*")
    (*w).Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    (*w).Header().Set("Access-Control-Allow-Headers", "Content-Type")
}

