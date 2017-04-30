let request = require('request-promise-native');
let cheerio = require('cheerio');
let _get = require('lodash.get');
let moment = require('moment');
let express = require('express');

class MFPStats {
    constructor(config = {}) {
        this.config = Object.assign({
            auth: {
                username: '',
                password: ''
            },
            express: {
                port: 5678,
            },
            fetchInterval: 6 * 60 * 60, // 6 hours
            mode: 'cli' // `cli` or `server`
        }, config);

        this.mfpDomain = 'myfitnesspal.com';
        this.mfpURL = `https://www.${this.mfpDomain}`;
        this.mfpAPI = `https://api.${this.mfpDomain}/v2`;

        this.authInfo = {};
        this.authed = false;
        this.updated = null;

        this.userData = {};
        this.latestWeight = {};
    }

    auth() {
        let authDetails = Object.assign({
            utf8: '✓',
        }, this.config.auth);

        return request({
            url: `${this.mfpURL}/`,
            method: 'GET',
            jar: true,
            resolveWithFullResponse: true
        }).then((resp) => {
            let doc = cheerio.load(resp.body);
            let token = doc('[name="authenticity_token"]').attr('value');
            authDetails['authenticity_token'] = token;

            return request({
                url: `${this.mfpURL}/account/login`,
                method: 'POST',
                form: authDetails,
                jar: true,
                simple: false,
                resolveWithFullResponse: true
            }).then((resp) => {
                if(resp.statusCode == 302) {
                    return request({
                        url: `${this.mfpURL}/user/auth_token`,
                        method: 'GET',
                        qs: {refresh: true},
                        jar: true,
                        headers: {
                            Accept: 'application/json',
                            'User-Agent': 'Mozilla/5.0' // Apparently they require a UA to be set
                        },
                        resolveWithFullResponse: true
                    }).then((resp) => {
                        this.authInfo = JSON.parse(resp.body);
                        this.authed = true;

                        return this.authInfo;
                    });
                } else {
                    return Promise.reject('Authentication Failure');
                }
            });
        });
    }

    getAuthHeaders() {
        if(!this.authed) {
            return {};
        } else {
            return {
                'Authorization': `Bearer ${this.authInfo.access_token}`,
                'mfp-client-id': 'mfp-main-js',
                'mfp-user-id': this.authInfo.user_id
            };
        }
    }

    getUserData() {
        if(!this.authed) {
            return Promise.reject('You must first authenticate');
        } else {
            let authHeaders = this.getAuthHeaders();

            return request({
                url: `${this.mfpAPI}/users/${this.authInfo.user_id}`,
                method: 'GET',
                qs: {
                    fields: [
                        'diary_preferences',
                        'goal_preferences',
                        'unit_preferences',
                        'account',
                        'goal_displays',
                        'location_preferences',
                        'system_data',
                        'profiles',
                        'step_sources',
                        'app_preferences'
                    ]
                },
                qsStringifyOptions: {
                    arrayFormat: 'brackets'
                },
                jar: true,
                headers: Object.assign({
                    Accept: 'application/json',
                    'User-Agent': 'Mozilla/5.0'
                }, authHeaders),
                resolveWithFullResponse: true
            }).then((resp) => {
                this.userData = JSON.parse(resp.body);

                return this.userData;
            });
        }
    }

    getLatestWeight() {
        if(!this.authed) {
            return Promise.reject('You must first authenticate');
        } else {
            let authHeaders = this.getAuthHeaders();

            return request({
                url: `${this.mfpAPI}/incubator/measurements`,
                method: 'GET',
                qs: {
                    most_recent: true,
                    type: 'weight'
                },
                jar: true,
                headers: Object.assign({
                    Accept: 'application/json',
                    'User-Agent': 'Mozilla/5.0'
                }, authHeaders),
                resolveWithFullResponse: true
            }).then((resp) => {
                this.latestWeight = JSON.parse(resp.body);

                return this.latestWeight;
            });
        }
    }

    fetchData() {
        return this.auth().then(() => {
            return this.getUserData();
        }).then(() => {
            return this.getLatestWeight();
        }).then(() => {
            this.updated = moment().format();

            return {
                userData: this.userData,
                latestWeight: this.latestWeight
            }
        });
    }

    buildStats() {
        // Collect info
        let startDate = _get(this.userData, 'item.profiles.0.starting_weight_date');
        let startWeight = _get(this.userData, 'item.profiles.0.starting_weight.value'); // Expect lbs for now
        let goalWeight = _get(this.userData, 'item.goal_preferences.weight_goal.value');
        let latestDate = _get(this.latestWeight, 'items.0.date');
        let latestWeight = _get(this.latestWeight, 'items.0.value');

        // Build stats
        let stats = {};

        stats.startDate = moment(startDate).format();
        stats.displayStartDate = moment(startDate).format('dddd, MMMM D, YYYY');
        stats.startWeight = startWeight;
        stats.goalWeight = goalWeight;
        stats.daysSinceStart = moment(latestDate).diff(moment(startDate), 'days');
        stats.currentWeight = latestWeight;
        stats.lost = parseFloat(startWeight) - parseFloat(latestWeight);
        stats.toLose = parseFloat(latestWeight) - parseFloat(goalWeight);
        stats.lostPercent = Math.round(((stats.lost / (startWeight - goalWeight)) * 100) * 10) / 10;
        stats.dailyAverage = stats.lost / stats.daysSinceStart;
        stats.daysLeft = stats.toLose / stats.dailyAverage;
        stats.goalDate = moment().add(stats.daysLeft, 'days').format();
        stats.displayGoalDate = moment(stats.goalDate).format('dddd, MMMM D, YYYY');
        stats.goalDuration = moment.duration(stats.daysLeft, 'days').humanize();

        // Waypoints
        stats.waypoints = [];
        if(latestWeight > goalWeight - 10) {
            for(let lw = Math.round(latestWeight); lw > Math.round(goalWeight); lw--) {
                if(lw % 10 == 0) {
                    let point = {};
                    point.weight = lw;
                    point.toLose = lw - goalWeight;
                    point.daysLeft = Math.round(point.toLose / stats.dailyAverage);
                    point.daysUntil = Math.round(stats.daysLeft - point.daysLeft);
                    point.date = moment().add(point.daysUntil, 'days').format();
                    point.displayDate = moment(point.date).format('dddd, MMMM D, YYYY');

                    stats.waypoints.push(point);
                }
            }
        }

        // Prettification
        stats.lost = Math.round(stats.lost * 10) / 10;
        stats.toLose = Math.round(stats.toLose * 10) / 10;
        stats.dailyAverage = Math.round(stats.dailyAverage * 10) / 10;
        stats.daysLeft = Math.round(stats.daysLeft);

        return stats;
    }

    stringifyStats(stats = {}) {
        let str = `Weight loss stats

            MFP username: ${(_get(this.userData, 'item.username'))}
            Starting weight: ${stats.startWeight} lbs
            Starting date: ${stats.displayStartDate} (${stats.daysSinceStart} days ago)
            Lost so far: ${stats.lost} lbs (currently at ${stats.currentWeight} lbs)
            Average daily loss: ${stats.dailyAverage} lbs
            Goal weight: ${stats.goalWeight} lbs
            Progress: ${stats.lostPercent}%
            Estimated success date: ${stats.displayGoalDate} (${stats.daysLeft} days remaining)`;

        let wp = '';
        stats.waypoints.forEach((pt) => {
            wp += `
                [${pt.weight} lbs] ${pt.displayDate}`;
        });
        if(wp.length > 0) {
            str += `

                Waypoints
                ${wp}`;
        }

        return str.replace(/^ */gm, '');
    }

    run() {
        if(this.config.mode == 'cli') {
            this.fetchData().then(() => {
                console.log(JSON.stringify(this.buildStats(), null, 2));
            }).catch((err) => {
                console.error(err);
            });
        } else if(this.config.mode == 'server') {
            // Start fetch
            let faults = 0;
            let fetchFn = () => {
                this.fetchData().then(() => {
                    setTimeout(fetchFn, this.config.fetchInterval * 1000);
                }).catch((err) => {
                    console.error(err);
                    faults = faults + 1;

                    if(faults > 10) {
                        console.error('Too many fetch errors! Exiting...');
                        process.exit(1);
                    }
                });
            };
            fetchFn();

            // Route requests
            let app = express();

            app.get('/progress.json', (req, res) => {
                let stats = this.buildStats();
                res.status(200).json({
                    stats,
                    updated: this.updated
                }).end();
            });

            app.get('/progress', (req, res) => {
                let stats = this.buildStats();
                let txt = this.stringifyStats(stats);
                res.set('Content-Type', 'text/plain');
                res.status(200).send(txt).end();
            });

            console.log(`Server listening on port ${this.config.express.port}...`)
            app.listen(this.config.express.port);
        } else {
            console.error('Incorrect mode configured');
        }
    }
}

if (require.main === module) {
    let config = {};

    try {
        config = require('./config.json');
    } catch(e) {
        console.error('Config missing or invalid.');
        process.exit(1);
    }

    let mfpstats = new MFPStats(config);
    mfpstats.run();
}