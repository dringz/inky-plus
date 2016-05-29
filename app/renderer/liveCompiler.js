const ipc = require("electron").ipcRenderer;
const _ = require("lodash");

var sessionId = 0;
var lastEditorChange = null;

var choiceSequence = [];
var currentReplayTurnIdx = -1;

var issues = [];
var selectedIssueIdx = -1;

var project = null;
var events = {}


function resetErrors() {
    issues = [];
    selectedIssueIdx = -1;
}

function reloadInklecateSession() {

    lastEditorChange = null;

    stopInklecateSession(sessionId);

    sessionId += 1;

    if( choiceSequence.length > 0 )
        currentReplayTurnIdx = 0;

    events.resetting();

    resetErrors();

    // Construct instruction object to send to inklecate.js
    var compileInstruction = {
        mainName: project.mainInk.filename(),
        updatedFiles: {}
    };

    project.files.forEach((inkFile) => {
        // Add Ink Files with changes to be saved before the next compile
        // If we're running for the first time, add all because non of the files has been saved to tempInkPath
        if( inkFile.compilerVersionDirty ) {
            compileInstruction.updatedFiles[inkFile.relativePath()] = inkFile.getValue();
            inkFile.compilerVersionDirty = false;
        }
    });

    if( !_.isEmpty(compileInstruction.updatedFiles) )
        ipc.send("play-ink", compileInstruction, sessionId);
}

function stopInklecateSession(idToStop) {
    ipc.send("play-stop-ink", idToStop);
}

function choose(choice) {
    ipc.send("play-continue-with-choice-number", choice.number, choice.sourceSessionId);
    choiceSequence.push(choice.number);
}

function rewind() {
    choiceSequence = [];
    currentReplayTurnIdx = -1;
    reloadInklecateSession();
}

function stepBack() {
    if( choiceSequence.length > 0 )
        choiceSequence.splice(-1, 1);
    reloadInklecateSession();
}

// --------------------------------------------------------
// Live re-compile loop
// --------------------------------------------------------

// Do first compile
// Really just for debug when loading ink immediately
// other actions will cause editor changes
setTimeout(reloadInklecateSession, 1000);

// compile loop - detect changes every 0.25 and make sure
// user has paused before actually compiling
setInterval(() => {
    if( lastEditorChange != null && Date.now() - lastEditorChange > 500 ) {
        lastEditorChange = null;
        reloadInklecateSession();
    }
}, 250);

// --------------------------------------------------------
// IPC event from the native menu option to cycle issues
// --------------------------------------------------------

ipc.on("next-issue", () => {
    if( issues.length > 0 ) {
        selectedIssueIdx++;
        if( selectedIssueIdx >= issues.length )
            selectedIssueIdx = 0;

        events.selectIssue(issues[selectedIssueIdx]);
    }
});

// --------------------------------------------------------
// IPC Events from inklecate.js
// --------------------------------------------------------

ipc.on("play-generated-text", (event, result, fromSessionId) => {

    if( fromSessionId != sessionId )
        return;

    var replaying = currentReplayTurnIdx != -1;
    events.textAdded(result, replaying);
});

ipc.on("play-generated-error", (event, error, fromSessionId) => {

    if( sessionId != fromSessionId )
        return;

    issues.push(error);
    events.errorAdded(error);
});

ipc.on("play-generated-choice", (event, choice, fromSessionId) => {

    if( fromSessionId != sessionId )
        return;

    choice.sourceSessionId = fromSessionId;

    var replaying = currentReplayTurnIdx >= 0 && currentReplayTurnIdx < choiceSequence.length;
    events.choiceAdded(choice, replaying);
});

ipc.on("play-requires-input", (event, fromSessionId) => {

    if( fromSessionId != sessionId )
        return;

    var replaying = currentReplayTurnIdx >= 0;
    events.playerPrompt(replaying);

    // Replay?
    if( replaying ) {
        var replayChoiceNumber = choiceSequence[currentReplayTurnIdx];
        currentReplayTurnIdx++;
        if( currentReplayTurnIdx >= choiceSequence.length )
            currentReplayTurnIdx = -1;
        ipc.send("play-continue-with-choice-number", replayChoiceNumber, fromSessionId);
    }
});

ipc.on("play-story-completed", (event, fromSessionId) => {

    if( fromSessionId != sessionId )
        return;

    events.storyCompleted();
});

ipc.on("play-story-unexpected-exit", (event, fromSessionId) => {

    if( sessionId != fromSessionId )
        return;

    events.unexpectedExit();
});

ipc.on("play-story-unexpected-error", (event, error, fromSessionId) => {

    if( sessionId != fromSessionId )
        return;

    events.unexpectedError(error);
});

ipc.on("play-story-stopped", (event, fromSessionId) => {

});

exports.LiveCompiler = {
    setProject: (p) => { project = p; },
    reload: reloadInklecateSession,
    setEdited: () => { lastEditorChange = Date.now(); },
    setEvents: (e) => { events = e; },
    getIssues: () => { return issues; },
    getIssuesForFilename: (filename) => _.filter(issues, i => i.filename == filename),
    choose: choose,
    rewind: rewind,
    stepBack: stepBack
}
