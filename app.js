const https = require('https');

// Todo: remove global vars
const appArguments = process.argv.slice(2);

if (!appArguments[0] || appArguments.length === 0) {
    console.log('App should be started with the following command:\nnode app.js <Stop Code e.g. E3158>');
    return;
}

let latestData = null;
let latestRefreshDate = null;
let screenSaveOffset = { x: 0, y: 0 };

let displayDelays = !(appArguments.length === 2 && appArguments[1] === 'delayoff') ;

displayDelays ? '' : console.log('Displaying delays disabled.')

let stop = {
    queryString: null,
    name: null,
    code: null,
};

function parseDepartures(data) {
    data = JSON.parse(data);

    let departures = data.data.stop.stoptimesWithoutPatterns;

    return departures.map(departure => {

        let delayMinutes = displayDelays ? Math.floor(departure.departureDelay / 60) : 0;

        return {
            title: departure.headsign,
            delayMinutes: delayMinutes,
            estimatedTime: departure.serviceDay + departure.scheduledDeparture + delayMinutes * 60
        }
    });
}

function getTimeUntilString(epochSeconds) {
    let timeDifferenceInSeconds = Math.abs(getTimeUntil(epochSeconds));

    let hours = Math.floor(timeDifferenceInSeconds / 3600)
    let minutes = Math.floor((timeDifferenceInSeconds / 60 - hours * 60));

    if (hours === 0) {
        return `${minutes}min`;
    } else {
        return `${hours}h ${minutes}min`;
    }
}

function getTimeUntil(epochSeconds) {
    return epochSeconds - new Date().getTime() / 1000 - new Date().getTimezoneOffset() / 60;
}

function getDateString(epochSeconds) {
    let date = new Date((epochSeconds) * 1000);
    return `${date.getDate()}.${date.getMonth() + 1} ${getHoursString(epochSeconds)}`;
}

function getHoursString(epochSeconds) {
    let date = new Date((epochSeconds) * 1000);
    return `${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function getRandom(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function makePostRequest(postData) {

    let options = {
        hostname: 'api.digitransit.fi',
        port: 443,
        path: '/routing/v1/routers/hsl/index/graphql',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': postData.length
        }
    };

    let promise = new Promise((resolve, reject) => {
        var req = https.request(options, (res) => {
            let data = '';

            if (res.statusCode !== 200) {
                reject(`Error status code: ${res.statusCode}`)
            }

            res.on('data', (d) => {
                data += d;
            });
            res.on('end', () => {
                resolve(data);
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        req.write(postData);
        req.end();
    });



    let result = await promise;

    return result;
}

function getSearchStopQuery(stopCode) {
    return JSON.stringify({
        query: `{
            stops(name: "${stopCode}") {
              gtfsId
              name
              code
              platformCode
            }
          }`
    })
}

function getStopDepartureQuery(stopID) {
    return JSON.stringify({
        query: `{
            stop(id: "${stopID}") {
              name
                stoptimesWithoutPatterns {
                headsign
                serviceDay
                scheduledDeparture
                departureDelay
                realtime
                realtimeState
              }
            }
          }`
    });
}

function printDisplay(stop, departures, latestRefreshDateInEpochSeconds, screenSaveOffset) {
    console.clear();
    console.log(screenSaveOffset.y);

    console.log(`${screenSaveOffset.x}${stop.name} ${stop.code} Next Departures:\n`);
    departures.forEach(d => {
        if (d.delayMinutes === 0) {
            console.log(`${screenSaveOffset.x}${d.title} at ${getHoursString(d.estimatedTime)} in ${getTimeUntilString(d.estimatedTime)}`);
        } else {
            let delayString = d.delayMinutes < 0 ? 'early' : 'late';
            console.log(`${screenSaveOffset.x}${d.title} at ${getHoursString(d.estimatedTime)} in ${getTimeUntilString(d.estimatedTime)}, ${Math.abs(d.delayMinutes)}min ${delayString}`);
        }
    });

    console.log(`\n${screenSaveOffset.x}Last HSL API refresh ${getTimeUntilString(latestRefreshDateInEpochSeconds)} ago.`)
}

function displayUpdateLoop() {
    // Requests new data if earliest departure is in the next 60 seconds.
    if (!latestData || latestData.length === 0 || getTimeUntil(latestData[0].estimatedTime) < 60) {
        makePostRequest(stop.queryString).then(data => {
            latestData = parseDepartures(data);
            latestRefreshDate = (new Date().getTime() / 1000);

            screenSaveOffset = {
                x: " ".repeat(getRandom(0, 10)),
                y: "\n".repeat(getRandom(0, 5))
            }
        }).catch(err => {
            console.error(err);
        })
    }

    if (latestData) printDisplay(stop, latestData, latestRefreshDate, screenSaveOffset)
}

console.log('Finding stop...')
makePostRequest(getSearchStopQuery(appArguments[0])).then(data => {
    data = JSON.parse(data);

    let stops = data.data.stops;
    if (!stops || stops.length === 0 || !stops[0].hasOwnProperty('gtfsId')) {
        console.log(`Could not find stop with code ${appArguments[0]}`)
    } else {
        stop = {
            queryString: getStopDepartureQuery(stops[0].gtfsId),
            name: stops[0].name,
            code: stops[0].code,
        }

        // Start loop;
        setInterval(displayUpdateLoop, 5 * 1000);
        displayUpdateLoop();
    }
}).catch(err => {
    console.log(`Could not find stop with code ${appArguments[0]}:`)
    console.log(err);
})







