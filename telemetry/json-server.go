package main

import (
        "fmt"
        "log"
        "net/http"
)

const jsonServerPort = ":8888"


func responder(w http.ResponseWriter, r *http.Request) {

        switch r.Method {
        case "GET":
                enableCors(&w)
                w.Write([]byte(jsonData))
        default:
                w.WriteHeader(http.StatusMethodNotAllowed)
                fmt.Fprintf(w, "Not supported.")
        }
}

func serveJSON() {
        http.HandleFunc("/telemetry", responder)

        log.Printf("JSON Telemetry Server started at http://localhost%s", jsonServerPort)
        log.Fatal(http.ListenAndServe(jsonServerPort, nil))
}

func enableCors(w *http.ResponseWriter) {
	(*w).Header().Set("Access-Control-Allow-Origin", "*")
}
