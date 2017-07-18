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

    _lb_to_kg(lb) {
        return lb / 2.2046;
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

    body_fat_navy(sex, height, abdomen, neck, hip, metric = false) {
        if(sex == 'm') {
            metric = hip || metric;
        }
        if(!metric || this.defaultMetric === false) {
            height = this._in_to_cm(height);
            abdomen = this._in_to_cm(abdomen);
            neck = this._in_to_cm(neck);
            if(sex == 'f') {
                hip = this._in_to_cm(hip);
            }
        }

        if(sex == 'm') {
            return 86.010 * Math.log(abdomen - neck) - 70.041 * Math.log(height) + 30.30;
        } else if(sex == 'f') {
            return 163.205 * Math.log(abdomen + hip - neck) - 97.684 * Math.log(height) - 78.387;
        }

        return false;
    }

    adjust_bmr(bmr, activity) {
        return bmr * activity;
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
}