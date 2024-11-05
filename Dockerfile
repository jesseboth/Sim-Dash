FROM node:latest

WORKDIR /usr/src/app
COPY . .


# Install required packages for Go
RUN apt-get update && \
    apt-get install -y wget && \
    rm -rf /var/lib/apt/lists/*

# Download and install Go
RUN wget -O go.tgz https://golang.org/dl/go1.18.1.linux-amd64.tar.gz && \
    tar -C /usr/local -xzf go.tgz && \
    rm go.tgz

# Set Go environment variables
ENV PATH="$PATH:/usr/local/go/bin"
ENV GOPATH="/go"
ENV GOBIN="/go/bin"

# Navigate to the telemetry directory and run the build script
WORKDIR /usr/src/app/telemetry
RUN ./build

# Navigate back to the root directory
WORKDIR /usr/src/app/web-server
RUN npm install

EXPOSE 3000
EXPOSE 8888
EXPOSE 9999

CMD ["node", "server.js"]
