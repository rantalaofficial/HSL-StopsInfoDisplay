const https = require('https');
const settings = require('./settings')

let latestData = null;
let latestRefreshDate = null;
let screenSaveOffset = { x: 0, y: 0 };

function parseDepartures(data) {
    data = JSON.parse(data);

    let departures = data.data.stop.stoptimesWithoutPatterns;

    return departures.map(departure => {

        let delayMinutes = settings.showDelays ? Math.floor(departure.departureDelay / 60) : 0;

        return {
            headsign: departure.headsign,
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
              patterns {
                headsign
                route {
                  shortName
                }
              }
            }
          }`
    })
}

function getStopDepartureQuery(stopID) {
    return JSON.stringify({
        query: `{
            stop(id: "${stopID}") {
                stoptimesWithoutPatterns {
                headsign
                serviceDay
                scheduledDeparture
                departureDelay
              }
            }
          }`
    });
}

function getDepartureName(stop, headsign) {
    // TODO: Find better solution to this:
    // This function tries to fix the problem when sometimes headisgns are not same matching with route shortNames.

    let s1, s2;
    s2 = headsign.toLowerCase();

    for (var key in stop) {
        if (stop.hasOwnProperty(key)) {
            s1 = key.toLowerCase()
            
            if (s1.includes(s2) || s2.includes(s1)) {
                return `${stop[key]} ${settings.showLongNames ? `${headsign} ` : ''}`
            }
        }
    }

    // Fallback to headsign only
    return headsign;
}

function printDisplay(stop, departures, latestRefreshDateInEpochSeconds, screenSaveOffset) {
    console.clear();
    console.log(screenSaveOffset.y);

    console.log(`${screenSaveOffset.x}${stop.name} ${stop.code} Departures:\n`);

    // This variable gets the longest first part length so that all times are padded inline
    let longestFirstPart = 0;
    let departureTexts = departures.map(d => {
        let firstPart = `${screenSaveOffset.x}${getDepartureName(stop, d.headsign)}`
        let secondPart = `at ${getHoursString(d.estimatedTime)} in ${getTimeUntilString(d.estimatedTime)}`

        if (d.delayMinutes > 0) secondPart += `, ${Math.abs(d.delayMinutes)}min ${d.delayMinutes < 0 ? 'early' : 'late'}`;

        if (firstPart.length > longestFirstPart) longestFirstPart = firstPart.length

        return {firstPart, secondPart}
    });

    departureTexts.forEach(d => {
        console.log(d.firstPart.padEnd(longestFirstPart) + d.secondPart);
    });

    console.log(`\n${screenSaveOffset.x}HSL API refresh ${getTimeUntilString(latestRefreshDateInEpochSeconds)} ago.`)
}

function displayUpdateLoop(stop) {
    // Requests new data if earliest departure is in the next 20 seconds.
    if (!latestData || latestData.length === 0 || getTimeUntil(latestData[0].estimatedTime) < 20) {
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
makePostRequest(getSearchStopQuery(settings.stopCode)).then(data => {
    data = JSON.parse(data);

    let stops = data.data.stops;
    if (!stops || stops.length === 0 || !stops[0].hasOwnProperty('gtfsId')) {
        console.log(`Could not find stop with code ${settings.stopCode}`)
    } else {
        let stop = {
            queryString: getStopDepartureQuery(stops[0].gtfsId),
            name: stops[0].name,
            code: stops[0].code,
        }

        // Maps headsign data to it's corresponding short name
        stops[0].patterns.forEach(pattern => {
            stop[pattern.headsign] = pattern.route.shortName
        });

        // Start loop;
        setInterval(() => displayUpdateLoop(stop), 5 * 1000);
        displayUpdateLoop(stop);
    }
}).catch(err => {
    console.log(`Could not find stop with code ${settings.stopCode}:`)
    console.log(err);
})







