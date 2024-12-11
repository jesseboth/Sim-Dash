package util

import (
    "bufio"
    "fmt"
    "os"
    "path/filepath"
    "strings"
)

func WriteFileTop(filePath string, value string) error {
	// Create the directory if it doesn't exist
	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	// Open the file for writing (create or truncate if it already exists)
	file, err := os.Create(filePath)
	if err != nil {
		return fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	// Write the value to the file
	_, err = fmt.Fprintf(file, "%s", value)
	if err != nil {
		return fmt.Errorf("failed to write to file: %w", err)
	}

	return nil
}

func ReadFileTop(filePath string) (string, error) {

    file, err := os.Open(filePath)
    if err != nil {
        return "", fmt.Errorf("failed to open file: %w", err)
    }
    defer file.Close()

    // Read the first line using a scanner
    scanner := bufio.NewScanner(file)
    if scanner.Scan() {
        line := strings.TrimSpace(scanner.Text())

        if err != nil {
            return line, fmt.Errorf("failed to convert to int: %w", err)
        }
            
        return line, nil
    }

    // Check for scanner errors
    if err := scanner.Err(); err != nil {
        return "", fmt.Errorf("error reading file: %w", err)
    }

    return "", fmt.Errorf("file is empty")
}

// readLines reads a whole file into memory and returns a slice of its lines
func ReadLines(path string) ([]string, error) {
    file, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    defer file.Close()

    var lines []string
    scanner := bufio.NewScanner(file)
    for scanner.Scan() {
        lines = append(lines, scanner.Text())
    }
    return lines, scanner.Err()
}