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

    bmi_class(bmi) {
        if(bmi <= 18.5) {
            return 'underweight';
        } else if(bmi < 25) {
            return 'normal';
        } else if(bmi < 30) {
            return 'overweight';
        } else {
            return 'obese';
        }
    }
}