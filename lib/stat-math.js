module.exports = class StatMath {
    constructor(defaultMetric = null) {
        this.defaultMetric = defaultMetric; // true = default metric; false = default imperial
        this._activity_multipliers = [
            1.2, // Very sedentary
            1.3,
            1.4,
            1.5,
            1.6,
            1.7,
            1.8,
            1.9 // Very active
        ];
    }

    _in_to_cm(inches, _inches = null) { // (inches) || (feet, inches)
        if(_inches !== null) {
            inches = (inches * 12) + _inches
        }

        return inches * 2.54;
    }

    _cm_to_in(cm) {
        return cm / 2.54;
    }

    _lb_to_kg(lb) {
        return lb / 2.2046;
    }

    _kg_to_lb(kg) {
        return kg * 2.2046;
    }

    bmr_mifflin_st_jeor(sex, weight, height, age, metric = false) {
        if(!metric || this.defaultMetric === false) {
            weight = this._lb_to_kg(weight);
            height = this._in_to_cm(height);
        }

        if(sex == 'm') {
            return 10 * weight + 6.25 * height - 5 * age + 5;
        } else if(sex == 'f') {
            return 10 * weight + 6.25 * height - 5 * age - 161;
        }

        return false;
    }

    adjust_bmr(bmr, activity) {
        return bmr * activity;
    }

    // ('m', height, neck, abdomen, metric = false) || ('f', height, neck, waist, hip, metric = false)
    body_fat_navy(sex, height, neck, abdomen, hip, metric = false) {
        if(sex == 'm') {
            metric = hip || metric;
            hip = undefined;
        }
        if(metric || this.defaultMetric === true) {
            height = this._cm_to_in(height);
            neck = this._cm_to_in(neck);
            abdomen = this._cm_to_in(abdomen);
            if(sex == 'f') {
                hip = this._cm_to_in(hip);
            }
        }

        if(sex == 'm') {
            return  86.010 * Math.log10(abdomen - neck) - 70.041 * Math.log10(height) + 36.76;
        } else if(sex == 'f') {
            return 163.205 * Math.log10(abdomen /* waist */ + hip - neck) - 97.684 * Math.log10(height) - 78.387;
        }

        return false;
    }

    body_fat_bmi_adult(bmi, age, sex) {
        return (1.20 * bmi) + (0.23 * age) - (10.8 * (sex == 'm' ? 1 : 0)) - 5.4;
    }

    body_fat_bmi_child(bmi, age, sex) {
        return (1.51 * bmi) - (0.70 * age) - (3.6 * (sex == 'm')) + 1.4;
    }

    body_fat_class(sex, pct) {
        if(sex == 'm') {
            if(pct < 2) {
                return 'dangerous';
            } else if(pct < 6) {
                return 'essential';
            } else if(pct < 14) {
                return 'athlete';
            } else if(pct < 18) {
                return 'fitness';
            } else if(pct < 25) {
                return 'average';
            } else if(pct >= 25) {
                return 'obese';
            }
        } else if(sex == 'f') {
            if(pct < 10) {
                return 'dangerous';
            } else if(pct < 14) {
                return 'essential';
            } else if(pct < 21) {
                return 'athlete';
            } else if(pct < 25) {
                return 'fitness';
            } else if(pct < 32) {
                return 'average';
            } else if(pct >= 32) {
                return 'obese';
            }
        }

        return false;
    }

    bmi(height, weight, metric = false) {
        if(!metric || this.defaultMetric === false) {
            weight = this._lb_to_kg(weight);
            height = this._in_to_cm(height);
        }

        let meters = height / 100;

        return weight / (meters * meters);
    }

    bmi_class(bmi, includeClass = true) {
        if(bmi <= 18.5) {
            return 'underweight';
        } else if(bmi < 25) {
            return 'normal';
        } else if(bmi < 30) {
            return 'overweight';
        } else {
            let obesityClass = '';
            if(includeClass) {
                if(bmi < 35) {
                    obesityClass = 'I';
                } else if(bmi < 40) {
                    obesityClass = 'II';
                } else {
                    obesityClass = 'III';
                }
            }

            return `obese${obesityClass ? ' ' + obesityClass : ''}`;
        }
    }

    bmi_risk(bmi, includeClass = false) {
        let risk = {
            risk: null,
            obesityClass: null
        };

        if(bmi < 25) {
            risk.risk = 'low';
        } else if(bmi < 30) {
            risk.risk = 'moderate';
        } else if(bmi < 35) {
            risk.risk = 'high';
            risk.obesityClass = 'I'
        } else if(bmi < 40) {
            risk.risk = 'very high';
            risk.obesityClass = 'II'
        } else {
            risk.risk = 'extremely high';
            risk.obesityClass = 'III'
        }

        return includeClass ? risk : risk.risk;
    }

    trend(points = []) {
        let valid = true;
        points = points.map((pt) => {
            if(Array.isArray(pt)) {
                if(pt.length == 2) {
                    return {x: pt[0], y: pt[1]};
                } else {
                    valid = false;
                    return;
                }
            } else if(typeof pt == 'object') {
                if(!('x' in pt) || !('y' in pt)) {
                    valid = false;
                    return;
                } else {
                    return pt;
                }
            } else {
                valid = false;
                return;
            }
        });
        if(!valid || points.length === 0) {
            return false;
        } else if (points.length == 1) {
            return 0;
        }

        let n = points.length;
        let a = n * points.reduce((accum, cur) => {
            return accum + (cur.x * cur.y);
        }, 0);
        let b = points.reduce((accum, cur) => {
            return accum + cur.x;
        }, 0) * points.reduce((accum, cur) => {
            return accum + cur.y
        }, 0);
        let c = n * points.reduce((accum, cur) => {
            return accum + (cur.x ** 2);
        }, 0);
        let d = points.reduce((accum, cur) => {
            return accum + cur.x;
        }, 0) ** 2;

        return (a - b) / (c - d);
    }
}