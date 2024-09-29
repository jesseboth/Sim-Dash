let player;  // Global variable to hold the player

videoID = undefined;

setInterval(currentVideoID, 5*1000);

async function onYouTubeIframeAPIReady() {
    currentVideoID();
}

async function youtubeVideo() {
  if (videoID != undefined && player == undefined) {
    console.log(videoID);
        player = new YT.Player('video-player', {
            height: '150',
            width: '267',
            videoId: videoID,
            playerVars: {
            autoplay: 1,
            controls: 0,
            },
            events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
            }
        });
    }
}

function onPlayerReady(event) {
  event.target.playVideo();
}

// Optionally: Function to stop the video
function stopVideo() {
  player.stopVideo();
}

async function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.ENDED) {
    player.destroy();
    player = undefined;
    videoID = undefined;
    await nextVideo();
    await currentVideoID();
  }
}

function nextVideo() {
    fetch('/next-video')
      .then(response => response.json())
      .then(data => {
        // telemetryType = data["type"]
      })
      .catch(error => null);
}

function currentVideoID() {
    fetch('/current-video')
      .then(response => response.json())
      .then(data => {
        videoID = data["type"]
        youtubeVideo();
      })
      .catch(error => null);
}

async function addVideo(url){
    fetch("/add-video", {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({url: url})
    })
    .then(response => {
        if (response.ok) {
            return response.json();
        }
    })
    .then(data => {
      if(data != null){
        if(!data.success){
          alert("Video add Failed");
        }
      }
    })
    .catch(error => {
        console.error('Error sending data to server:', error);
    });
  }
