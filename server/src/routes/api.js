const router = require('express').Router();
const uuid = require('uuid');
const { randomBytes } = require('crypto');
const { sendMessage, setupQueueForNoteBook, deleteQueue } = require('../config/rabbitmq.js');
const { errorResponse, successResponse, getFromRedis } = require('../utils/responses.js');
const { createTimestamp, exceedsTimeout } = require('../utils/executionTimeout.js');
const { setRedisInitial, testSetHashKey, setRedisHashkey, getField, getAllFields } = require('../utils/redisHelpers.js');

const { basicDataCheck } = require('../utils/basicDataCheck.js');

const activeNotebooks = {}
// const { createNewWorker } = require('../utils/workerTerminal.js');
const { restartContainer, createNewWorker, startContainer, workerRunning, containerExists, killContainer, removeContainer, containerActive } = require('../utils/workerManager.js');

// TODO check if the worker is on? 
router.post('/submit', async (req, res, next) => {
  let thrown = {};
  try {
    basicDataCheck(req, thrown);
    const { notebookId, cells } = req.body;

    const workerExists = await containerExists(notebookId);
    if (!activeNotebooks[notebookId] && !workerExists) {
      createNewWorker(notebookId);
      activeNotebooks[notebookId] = true;
      //!replace with a sqL call to db
    }
    const data = { notebookId, cells }
    setupQueueForNoteBook(notebookId);

    data.folder = randomBytes(10).toString('hex');
    const submissionId = data.folder.toString();
    createTimestamp(submissionId, 10000);
    console.log('apiRoutesReq.body', data)
    // !TOGGLED sendMessage OFF FOR TESTING
    await sendMessage(data, notebookId);
    await setRedisHashkey(submissionId, {
      status: 'pending',
      notebookId: notebookId,
      timeRequested: Date.now(),
      timeProcessed: null,
      output: null,
    });

    // TODO set on redis: submissionId -> {status: 'pending', timestamp: Date.now(), notebookId: notebookId}

    res.status(202).json({
      submissionId,
    });
  } catch (error) {
    console.log(error);
    if (thrown.yes) {
      delete thrown.yes;
      res.status(400).send(errorResponse(400, error));
    } else {
    res.status(500).send(errorResponse(500, "System error"));
    }
  }
});


// is the context active or not?
router.get('/notebookstatus/:notebookId', (req, res, next) => { });

// reset context object

router.post('/reset/:notebookId', (req, res, next) => {
  try {
    if(!activeNotebooks[req.params.notebookId]) {
      throw 'that notebook ID does not exist'
    }
  resetContext(req.params.notebookId);
  res.json({ message: 'Context reset!' });
  } catch (error) {
    console.log(error)
    res.status(404).send(errorResponse(404, error));
  }
});

// TODO: More robust error handling that can distinguish between user code timeouts and system errors
const statusCheckHandler = async (req, res) => {
  try {
    let key = req.params.id;
    // let status = await getFromRedis(key);  // ! Redis shape will change
    // ! propose:
    // let status = await getFromRedis(key).status;  // ! Redis shape will change 
    // console.log('status from redis: ', status);
    // console.log('status', status)

    const status = await getField(key, 'status');
    console.log('status 🦇', status)
    const outputField = await getField(key, 'output');
    const output = JSON.parse(outputField);

    // !  error on exceedsTimeout
    console.log('exceedsTimeout: ', exceedsTimeout(key));

    // ! bugs with sending statuses
    // TODO result processing needs to accomodate redis hashkeys
    //create conditional with payload of {"status": "critical error"}
    if ((status === null || status === 'sent to queue' || status === 'pending' ) && exceedsTimeout(key)) {
      console.log('exceeded timeout context reset')
      //TODO create a spindown worker?
      //TODO call it
      //TODO call createNewWorker()

      //


      //
      res.status(202).send({ "status": "critical error", "message": "Your notebook environment has been reset. If you were changing already declared variables, and you believe that your logic is correct, run your code one more time and it should work." });

    } else if (status === null || status === 'sent to queue' || status === 'pending') {
      console.log('sent to queue branch')
      res.status(202).send({ "status": "pending" });
    }
    else if (status == 'Processing') {
      console.log('processing brqanch')
      console.log('processing')
      res.status(202).send({ "status": "pending" });
    }
    else {
      // status = JSON.parse(status);

      console.log('else branch')
      res.status(200).send(output);
    }
  } catch (error) {
    console.log('error happend 🐈️')
    res.status(500).send(errorResponse(500, "System error: ", error));
  }

}
router.get("/status/:id", statusCheckHandler);

//added
router.get("/results/:id", statusCheckHandler);


const Docker = require('dockerode');
const docker = new Docker();

// ! testing only
router.get('/test', async (req, res) => {

  try {
    // removeContainer('looper');
    // restartContainerHandler('looper')
    // await testSetHashKey('testRoomId', {name: 'booger', age: 30});

    // await setRedisHashkey('testRoomId', 'timeRequested')
    // const watermelon = await getAllFields('dc0b4e04a3cda10c2eb8')


    // const watermelon = await getField('f5ce22c57e209a1b0aad', 'output');
    const watermelon = await getAllFields('f5ce22c57e209a1b0aad');






    res.send(watermelon);
  } catch (error) {
    console.log('stuff wnet down :*( ', error)
    res.send('not ok')
  }
})



const restartContainerHandler = async (notebookId) => {
  try {
    const running = await workerRunning(notebookId);
    const containerStopped = await containerExists(notebookId);
    await deleteQueue(notebookId);

    if (running) {
      console.log('restarting notebook container')
      await restartContainer(notebookId)
    } else if (containerStopped) {
      console.log('Notebook container was stopped. Starting')
      await startContainer(notebookId);
    } else {
      console.log(`Notebook container did not exist. Creating new worker for ${notebookId}`);
      await createNewWorker(notebookId);
    }

    console.log('container restarted')
    return;
  } catch (error) {
    console.log(error);
    return;
  }
}


/* 
if there's a timeout
  - check if the container is still running
    - if it is, stop it
    - if it isn't, restart it
*/



module.exports = router;