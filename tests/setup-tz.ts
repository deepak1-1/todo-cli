// Pin all tests to IST so SQLite 'localtime' and JS Date.getDate() agree with CI
process.env.TZ = 'Asia/Kolkata';
