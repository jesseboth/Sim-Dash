# Forza data tools
Building some tools for playing with the UDP data out feature from the Forza Motorsport 7 / Forza Horizon 4 games. Built with [golang](https://golang.org/dl/).  




## Features
- Realtime telemetry output to terminal  
- Telemetry data logging to csv file  
- Serve Forza Telemetry data as JSON over HTTP
- Display race statistics from race/drive (when logging to CSV)  



(Feel free to open an issue if you have any suggestions/feature requests)
&nbsp;

## Setup
From your game HUD options, enable the data out feature and set it to use the IP address of your computer. Port 9999.  

Forza Motorsport 7 select the "car dash" format.

&nbsp;

## Build
Start the add
* ./docker.sh start 

Allow the app to start on boot
* ./docker.sh daemon

Stop the app
* ./docker.sh stop

&nbsp;

### JSON Data
If the `-j` flag is provided, JSON data will be available at: http://localhost:8888/forza. Could be used to make a web dashboard interface or something similar. JSON Format is an array of objects containing the various Forza data types.  

You can see a sample of the kind of data that will be returned [here](https://github.com/richstokes/Forza-data-tools/blob/master/dash/sample.json).  

There is a basic example JavaScript dashboard (with rev limiter function) in the `/dash` directory.  

&nbsp; 

## Further reading
- Forza data out format: https://forums.forzamotorsport.net/turn10_postsm926839_Forza-Motorsport-7--Data-Out--feature-details.aspx#post_926839

- Forza Motorsport: https://support.forzamotorsport.net/hc/en-us/articles/21742934024211-Forza-Motorsport-Data-Out-Documentation

- Forza Horizon 4 has some mystery data in the packet, waiting on info from the developers: https://forums.forzamotorsport.net/turn10_postsm1086012_Data-Output.aspx#post_1086012
