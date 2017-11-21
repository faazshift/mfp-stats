let request = require('request-promise-native');
let cheerio = require('cheerio');
let _get = require('lodash.get');
let moment = require('moment');
let express = require('express');

let statmath = require('./lib/stat-math');

class MFPStats {
    constructor(config = {}) {
        this.config = Object.assign({
            profiles: {},
            express: {
                port: 5678,
            },
            features: {
                exposeImages: false
            },
            fetchInterval: 6 * 60 * 60, // 6 hours
            mode: 'cli' // `cli` or `server`
        }, config);

        this.statHelper = new statmath(false);

        this.mfpDomain = 'myfitnesspal.com';
        this.mfpURL = `https://www.${this.mfpDomain}`;
        this.mfpAPI = `https://api.${this.mfpDomain}/v2`;

        this.profiles = [];
        Object.keys(this.config.profiles).forEach((profile) => {
            this.profiles.push({
                name: profile,
                config: this.config.profiles[profile],
                authInfo: {},
                authed: false,
                updated: null,
                userData: {},
                latestWeight: {},
                measurements: []
            });
        });
    }

    auth(authConfig = {}) {
        let authDetails = Object.assign({
            utf8: '✓',
        }, authConfig);

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
                        let authInfo = JSON.parse(resp.body);
                        let authed = true;

                        return { authInfo, authed };
                    });
                } else {
                    return Promise.reject('Authentication Failure');
                }
            });
        });
    }

    getAuthHeaders(profile = {}) {
        if(!profile.authed) {
            return {};
        } else {
            return {
                'Authorization': `Bearer ${profile.authInfo.access_token}`,
                'mfp-client-id': 'mfp-main-js',
                'mfp-user-id': profile.authInfo.user_id
            };
        }
    }

    getUserData(profile = {}) {
        if(!profile.authed) {
            return Promise.reject('You must first authenticate');
        } else {
            let authHeaders = this.getAuthHeaders(profile);

            return request({
                url: `${this.mfpAPI}/users/${profile.authInfo.user_id}`,
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
                return JSON.parse(resp.body);
            });
        }
    }

    getLatestWeight(profile = {}) {
        if(!profile.authed) {
            return Promise.reject('You must first authenticate');
        } else {
            let authHeaders = this.getAuthHeaders(profile);

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
                return JSON.parse(resp.body);
            });
        }
    }

    getMeasurements(profile = {}, options = { images: false, imageUrls: false }) {
        if(!profile.authed) {
            return Promise.reject('You must first authenticate');
        } else {
            let authHeaders = this.getAuthHeaders(profile);
            let commonOpts = {
                method: 'GET',
                jar: true,
                headers: Object.assign({
                    Accept: 'application/json',
                    'User-Agent': 'Mozilla/5.0'
                }, authHeaders),
                resolveWithFullResponse: true
            };

            let promises = [
                request(Object.assign({
                    url: `${this.mfpAPI}/measurements`
                }, commonOpts)).then((resp) => { return JSON.parse(resp.body) })
            ];

            if(options.images) {
                promises.push(
                    request(Object.assign({
                        url: `${this.mfpAPI}/image-associations`
                    }, commonOpts)).then((resp) => { return JSON.parse(resp.body) })
                );
                promises.push(
                    request(Object.assign({
                        url: `${this.mfpAPI}/images`
                    }, commonOpts)).then((resp) => { return JSON.parse(resp.body) })
                );
            }

            return Promise.all(promises).then(([measurements, imageAssoc, images]) => {
                measurements = _get(measurements, 'items', []).sort((a, b) => {
                    if(!('date' in a) || !('date' in b) || a.date == b.date) {
                        return 0;
                    }
                    return a.date > b.date ? 1 : -1;
                });

                if(options.images) {
                    imageAssoc = _get(imageAssoc, 'items', []).reduce((accum, obj) => {
                        accum[obj.resource_id] = obj;
                        return accum;
                    }, {});
                    images = _get(images, 'items', []).reduce((accum, obj) => {
                        accum[obj.id] = obj;
                        return accum;
                    }, {});

                    measurements.forEach((m, idx) => {
                        if(m.id in imageAssoc) {
                            measurements[idx].imageAssoc = imageAssoc[m.id];
                            if(measurements[idx].imageAssoc.image_id in images) {
                                measurements[idx].image = images[measurements[idx].imageAssoc.image_id];
                            }
                        }
                    });
                }

                return options.images && options.imageUrls ? new Promise((resolve, reject) => {
                    return measurements.reduce((accum, cur, idx) => {
                        return accum.then(() => {
                            if('image' in cur) {
                                let imageLink = `${this.mfpAPI}/images/${cur.image.id}/download`;
                                return request(Object.assign({
                                    url: imageLink,
                                    followAllRedirects: true
                                }, commonOpts)).then((resp) => {
                                    measurements[idx].imageUrl = _get(resp, 'request.uri.href', null);
                                });
                            }
                        });
                    }, Promise.resolve()).then(() => {
                        resolve(measurements);
                    }).catch((err) => {
                        reject(err);
                    });
                }) : Promise.resolve(measurements);
            });
        }
    }

    fetchData() {
        let promises = [];

        this.profiles.forEach((profile, idx) => {
            promises.push(
                this.auth(profile.config).then(({ authInfo, authed }) => {
                    this.profiles[idx].authInfo = authInfo;
                    this.profiles[idx].authed = authed;

                    return this.getUserData(profile).then((userData) => {
                        this.profiles[idx].userData = userData;
                    });
                }).then(() => {
                    return this.getLatestWeight(profile).then((latestWeight) => {
                        this.profiles[idx].latestWeight = latestWeight;
                    });
                }).then(() => {
                    let opts = this.config.features.exposeImages ? { images: true, imageUrls: true } : undefined;
                    return this.getMeasurements(profile, opts).then((measurements) => {
                        this.profiles[idx].measurements = measurements;
                    });
                }).then(() => {
                    this.profiles[idx].updated = moment().format();
                    return this.profiles[idx];
                })
            );
        });

        return Promise.all(promises);
    }

    buildStats(profileData = {}) {
        // Collect info
        let sex = _get(profileData.userData, 'item.profiles.0.sex').toLowerCase();
        let height = _get(profileData.userData, 'item.profiles.0.height.value'); // For now, we'll assume imperial
        let birthdate = _get(profileData.userData, 'item.profiles.0.birthdate');
        let age = moment().diff(moment(birthdate), 'years');

        let startDate = _get(profileData.userData, 'item.profiles.0.starting_weight_date');
        let startWeight = _get(profileData.userData, 'item.profiles.0.starting_weight.value'); // Expect lbs for now
        let goalWeight = _get(profileData.userData, 'item.goal_preferences.weight_goal.value');
        let latestDate = _get(profileData.latestWeight, 'items.0.date');
        let latestWeight = _get(profileData.latestWeight, 'items.0.value');

        // Build stats
        let stats = {};

        stats.startDate = moment(startDate).format();
        stats.displayStartDate = moment(startDate).format('dddd, MMMM D, YYYY');
        stats.startWeight = startWeight;
        stats.startBmi = parseFloat(this.statHelper.bmi(height, startWeight).toFixed(1));
        stats.startBmiClass = this.statHelper.bmi_class(stats.startBmi);
        stats.startBmiRisk = this.statHelper.bmi_risk(stats.startBmi);
        stats.goalWeight = goalWeight;
        stats.daysSinceStart = moment(latestDate).diff(moment(startDate), 'days');
        stats.lastWeight = latestWeight;
        stats.lost = parseFloat(startWeight) - parseFloat(latestWeight);
        stats.toLose = parseFloat(latestWeight) - parseFloat(goalWeight);
        stats.lostPercent = Math.round(((stats.lost / (startWeight - goalWeight)) * 100) * 10) / 10;
        stats.dailyAverage = stats.lost / stats.daysSinceStart;
        stats.daysLeft = stats.toLose / stats.dailyAverage;
        stats.goalDate = moment().add(stats.daysLeft, 'days').format();
        stats.displayGoalDate = moment(stats.goalDate).format('dddd, MMMM D, YYYY');
        stats.goalDuration = moment.duration(stats.daysLeft, 'days').humanize();
        stats.daysSinceLastWeight = moment().diff(moment(latestDate), 'days');
        stats.estimatedWeight = latestWeight - (stats.dailyAverage * stats.daysSinceLastWeight);
        stats.bmr = this.statHelper.bmr_mifflin_st_jeor(sex, latestWeight, height, age);
        stats.sedentaryKcal = this.statHelper.adjust_bmr(stats.bmr, 1.3);
        stats.activeKcal = this.statHelper.adjust_bmr(stats.bmr, 1.5);
        stats.veryActiveKcal = this.statHelper.adjust_bmr(stats.bmr, 1.7);
        stats.bmi = this.statHelper.bmi(height, latestWeight);
        stats.bmiClass = this.statHelper.bmi_class(stats.bmi);
        stats.bmiRisk = this.statHelper.bmi_risk(stats.bmi);

        // Waypoints
        stats.waypoints = [];
        if(latestWeight > goalWeight - 10) {
            for(let lw = Math.floor(latestWeight); lw > Math.round(goalWeight); lw--) {
                if(lw % 10 == 0) {
                    let point = {};
                    point.weight = lw;
                    point.toLose = lw - goalWeight;
                    point.bmi = this.statHelper.bmi(height, lw);
                    point.bmiClass = this.statHelper.bmi_class(point.bmi);
                    point.bmiRisk = this.statHelper.bmi_risk(point.bmi);
                    point.daysLeft = Math.round(point.toLose / stats.dailyAverage);
                    point.daysUntil = Math.round(stats.daysLeft - point.daysLeft);
                    point.date = moment().add(point.daysUntil, 'days').format();
                    point.displayDate = moment(point.date).format('dddd, MMMM D, YYYY');

                    point.bmi = point.bmi.toFixed(1);

                    stats.waypoints.push(point);
                }
            }
        }

        // Measurement history
        stats.measurements = _get(profileData, 'measurements', []).map(({date, unit, type, value, imageUrl}) => {
            let m = {date, unit, type, value};
            if(imageUrl) {
                m.imageUrl = imageUrl;
            }
            return m;
        });

        // Prettification
        stats.lost = Math.round(stats.lost * 10) / 10;
        stats.toLose = Math.round(stats.toLose * 10) / 10;
        stats.estimatedWeight = Math.round(stats.estimatedWeight * 10) / 10;
        stats.dailyAverage = Math.round(stats.dailyAverage * 10) / 10;
        stats.daysLeft = Math.round(stats.daysLeft);
        stats.bmr = Math.round(stats.bmr);
        stats.sedentaryKcal = Math.round(stats.sedentaryKcal);
        stats.activeKcal = Math.round(stats.activeKcal);
        stats.veryActiveKcal = Math.round(stats.veryActiveKcal);
        stats.bmi = parseFloat(stats.bmi.toFixed(1));

        return stats;
    }

    stringifyStats(profile = {}, stats = {}) {
        let str = `Weight loss stats

            MFP username: ${(_get(profile.userData, 'item.username'))}
            Starting weight: ${stats.startWeight} lbs (${stats.startBmi} bmi / ${stats.startBmiClass})
            Starting date: ${stats.displayStartDate} (${stats.daysSinceStart} days ago)
            Lost so far: ${stats.lost} lbs (most recently at ${stats.lastWeight} lbs) (${stats.bmi} bmi / ${stats.bmiClass})
            Estimated current weight: ${stats.estimatedWeight} lbs (${stats.daysSinceLastWeight} days since last weigh-in)
            Metabolic rate: ${stats.bmr}
            Caloric needs for maintenance: sedentary - ${stats.sedentaryKcal}; active - ${stats.activeKcal}; very active - ${stats.veryActiveKcal}
            Average daily loss: ${stats.dailyAverage} lbs
            Goal weight: ${stats.goalWeight} lbs
            Progress: ${stats.lostPercent}%
            Estimated success date: ${stats.displayGoalDate} (${stats.daysLeft} days remaining)`;

        let wp = '';
        stats.waypoints.forEach((pt) => {
            wp += `
                [${pt.weight} lbs] ${pt.displayDate} (${pt.bmi} bmi / ${pt.bmiClass})`;
        });
        if(wp.length > 0) {
            str += `

                Waypoints
                ${wp}`;
        }

        return str.replace(/^ */gm, '');
    }

    buildAllStats() {
        let stats = {};

        this.profiles.forEach((profile) => {
            stats[profile.name] = this.buildStats(profile);
        });

        return stats;
    }

    handleRequest(profileIdx, req, res) {
        let stats = this.buildStats(this.profiles[profileIdx]);
        let txt = this.stringifyStats(this.profiles[profileIdx], stats);
        res.set('Content-Type', 'text/plain');
        res.status(200).send(txt).end();
    }

    handleRequestJson(profileIdx, req, res) {
        let stats = this.buildStats(this.profiles[profileIdx]);
        res.status(200).json({
            stats,
            updated: this.profiles[profileIdx].updated
        }).end();
    }

    run() {
        if(this.config.mode == 'cli') {
            this.fetchData().then(() => {
                console.log(JSON.stringify(this.buildAllStats(), null, 2));
            }).catch((err) => {
                console.error(err);
            });
        } else if(this.config.mode == 'server') {
            // Start fetch
            let fetchFn = () => {
                this.fetchData().catch((err) => {
                    console.error(err);
                }).then(() => {
                    setTimeout(fetchFn, this.config.fetchInterval * 1000);
                });
            };
            fetchFn();

            // Route requests
            let app = express();

            this.profiles.forEach((profile, idx) => {
                app.get(`/${profile.name}`, this.handleRequest.bind(this, idx));
                app.get(`/${profile.name}.json`, this.handleRequestJson.bind(this, idx));
            });

            app.get('/', (req, res) => {
                let profileLinks = this.profiles.map((profile) => {
                    return `<div>${profile.name}: <a href="/${profile.name}">text</a> | <a href="/${profile.name}.json">json</a></div>`;
                }).join('');
                let forkLink = `<div>Fork me on <a href="https://github.com/faazshift/mfp-stats">Github</a></div>`;
                res.status(200).send(`<html><body>Profiles:<div>-----</div>${profileLinks}<div>-----</div><br/><br/>${forkLink}</body></html>`).end();
            })

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
        console.error(e);
        process.exit(1);
    }

    let mfpstats = new MFPStats(config);
    mfpstats.run();
}