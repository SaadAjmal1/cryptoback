const Queue = require('bull');
const setQueues = require('bull-board').setQueues;

const ProgramModel = require('../App/Programs/model');
const DPayoutsModel = require('../App/DPayouts/model');

const BlockchainExc = require('blockchain.info/exchange');

const request = require('request-promise');

const environment = require('dotenv');
environment.config();

const redisOptions = require('../constant/redisConnection');

const dailyCommissionQueue = new Queue('dailyCommission', redisOptions);
setQueues([dailyCommissionQueue]);

dailyCommissionQueue.process( async (job, done) => {
    let commission = 0, commissionToAdd = 0;
    const programs = await ProgramModel.find({
        programEnds: 'No'
    });
    const currentRates = await request({
        url: 'https://api.coingecko.com/api/v3/exchange_rates',
        method: 'GET',
        json: true
    });
    const bchValue = currentRates.data.rates['bch'].value
    const usdValue = currentRates.data.rates['usd'].value
    const usdRate = usdValue / bchValue;
    const bchRate = bchValue / usdValue;
    for (const program of programs) {
            commissionToAdd = 0;
            const tCommission = program.totalCommission * usdRate;
            const dCommission = (program.workingCapital * program.plan.dailyCommision / 100) * bchRate;
            const wCommission = (program.weeklyCommission + dCommission) * usdRate;
            if (tCommission < (program.investment * 1.8)) {
                if ((tCommission + wCommission) <= (program.investment * 1.8)) {
                    commission = program.weeklyCommission + dCommission
                    commissionToAdd = dCommission;
                    if ((tCommission + wCommission) === (program.investment * 1.8)) {
                        await ProgramModel.updateOne({ _id: program._id }, {
                            programEnds: 'Yes'
                        });
                    }
                } else {
                    let value = (program.investment * 1.8) - tCommission - (program.weeklyCommission * usdRate);
                    commissionToAdd = value * bchRate;
                    commission = program.weeklyCommission + commissionToAdd;
                    await ProgramModel.updateOne({ _id: program._id }, {
                        programEnds: 'Yes'
                    });
                }
            }
            const days = program.days + 1;
            await ProgramModel.updateOne({ _id: program._id }, {
                days: days,
                payWeek: 'Yes',
                weeklyCommission: commission
            });
            await DPayoutsModel.create({
                user: program.user._id,
                amount: commissionToAdd,
                plan: program.plan._id,
                program: program._id
            });
    }
    done();
});

module.exports = async () => {
    await dailyCommissionQueue.add({}, {
        repeat: {cron: '0 23 * * 1-5'}
    });
}