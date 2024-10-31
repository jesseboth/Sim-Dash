#!/usr/bin/env bash

IMAGENAME="sim-telemetry"
CONTAINERNAME="${IMAGENAME}-container"
POSTGRESNAME="${IMAGENAME}-postgres"
POSTGRES_PASSWORD="simrace"
PORTS="-p 8888:8888 -p 3000:3000 -p 9999:9999"

SCRIPT_DIR=$(realpath $(dirname "$0"))
VOLUMES="-v ${SCRIPT_DIR}/web-server/data:/usr/src/app/web-server/data"

build(){
  if ! docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINERNAME}$"; then
    echo "Building $CONTAINERNAME"
    docker build -t "$IMAGENAME" .
  fi
}

stop(){
  docker update --restart=no $CONTAINERNAME
  docker stop $CONTAINERNAME
}

newJsonFile() {
  if [ -f ${SCRIPT_DIR}/$1 ]; then
    return
  fi

  touch ${SCRIPT_DIR}/$1
  echo "{}" > $1
}


start-postgres(){
  # Check if the container already exists
  if [ "$(docker ps -a -q -f name=$POSTGRESNAME)" ]; then
      echo "Container '$POSTGRESNAME' already exists."

      # Start the container if it’s not already running
      if [ "$(docker ps -q -f name=$POSTGRESNAME)" ]; then
          echo "Container '$POSTGRESNAME' is already running."
      else
          echo "Starting the existing container '$POSTGRESNAME'..."
          docker start $POSTGRESNAME
      fi
  else
      echo "Creating and starting a new container '$POSTGRESNAME'..."

      # Run the container with the specified configurations
      docker run --name $POSTGRESNAME \
        --network host \
        -e POSTGRES_PASSWORD=$POSTGRES_PASSWORD \
        -v $SCRIPT_DIR/postgresdb:/var/lib/postgresql/data \
        -d postgres  # Use 'postgres' as the image name

      echo "Container '$POSTGRESNAME' created and started."
  fi
}

start() {
  newJsonFile web-server/data/odometers.json
  newJsonFile web-server/data/splits.json

  start-postgres
  docker run -d $PORTS $VOLUMES --network host --restart always --name "$CONTAINERNAME" "$IMAGENAME"
}

if [ "$1" == "help" ] || [ "$1" == "-h" ] || [ "$1" == "--help" ]; then
  echo "Build the docker container:"
  echo "./docker.sh: Creates container and starts right now"
  echo "./docker.sh stop: Stops the container"
  echo "./docker.sh restart: Stops the container"
  echo "./docker.sh help: Display this message"
elif [ "$1" == "postgres" ]; then
  start-postgres
elif [ "$1" == "backup" ]; then
  docker exec -t $POSTGRESNAME pg_dump -U postgres -F c -b -v -f $SCRIPT_DIR/backup.sql postgres
elif [ "$1" == "stop" ]; then
  stop
elif [ "$1" == "restart" ]; then
  stop
  docker rm $CONTAINERNAME
  build
  start
elif [ "$1" == "remove" ]; then
  stop
  docker rm $CONTAINERNAME
elif [ "$1" == "enter" ]; then
  docker exec -it $CONTAINERNAME bash
else
  build
  start
fi
