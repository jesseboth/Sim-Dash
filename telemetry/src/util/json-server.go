package util

import (
        "fmt"
        "log"
        "net/http"
        "net"
        "sync"
)

var (
        mu sync.Mutex
        jsonData string
    )

const jsonServerPort = ":8888"


func responder(w http.ResponseWriter, r *http.Request) {
    switch r.Method {
    case "GET":
        enableCors(&w)
        
        // Lock the mutex before reading jsonData
        mu.Lock()
        data := jsonData
        mu.Unlock()

        w.Write([]byte(data))
    default:
        w.WriteHeader(http.StatusMethodNotAllowed)
        fmt.Fprintf(w, "Not supported.")
    }
}

func ServeJson() {
    http.HandleFunc("/telemetry", responder)

    log.Printf("JSON Telemetry Server started at http://localhost%s", jsonServerPort)
    log.Fatal(http.ListenAndServe(jsonServerPort, nil))
}

// GetOutboundIP finds preferred outbound ip of this machine
func GetOutboundIP() net.IP {
    conn, err := net.Dial("udp", "1.2.3.4:4321") // Destination does not need to exist, using this to see which is the primary network interface
    if err != nil {
        log.Fatal(err)
    }
    defer conn.Close()

    localAddr := conn.LocalAddr().(*net.UDPAddr)

    return localAddr.IP
}
    
func SetJson(str string){
    mu.Lock()
    defer mu.Unlock()
    jsonData = str
}

// INTERNAL FUNCTIONS
func enableCors(w *http.ResponseWriter) {
    (*w).Header().Set("Access-Control-Allow-Origin", "*")
}

