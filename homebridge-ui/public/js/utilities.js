function loadJSON(url) {
    return fetch(url).then(response => response.json());
}

function doTransition(elementFrom, elementTo) {
    const mainElement = document.getElementById("main");
    if(elementFrom) {
        transitionFadeIn(elementFrom, elementTo, mainElement);
    } else {
        transitionFadeOut(null, elementTo, mainElement);
    }
}

function transitionFadeIn(elementFrom, elementTo, mainElement) {
    mainElement.classList.add("transiting");
    elementFrom.classList.add('transition-from');
    setTimeout(() => {
        transitionFadeOut(elementFrom, elementTo, mainElement);
    }, 500); // after 500ms
}

function transitionFadeOut(elementFrom, elementTo, mainElement) {
    if(elementFrom && !elementFrom.classList.contains("hidden")) {
        elementFrom.classList.add("hidden");
    }
    if(elementTo.classList.contains('hidden')) {
        elementTo.classList.remove('hidden');
    }
    elementTo.classList.add("start-fade-out");
    setTimeout(() => {
        elementTo.classList.remove('start-fade-out');
        elementTo.classList.remove('hidden');
        if(elementFrom) {
            elementFrom.classList.remove('transition-from');
        }
        mainElement.classList.remove('transiting');
    }, 500); // after 500ms again
}

function createElement(tagName, options) {
    options = options || {};

    const element = document.createElement(tagName);
    for(const key of Object.keys(options)) {
        element[key] = options[key];
    }
    return element;
}

let timerIntervalId = -1;
let remainingDuration = 0;

function stopTimer() {
    if(timerIntervalId > 0) {
        clearInterval(timerIntervalId);
        timerIntervalId = -1;
    }
}

function startTimer(duration, onTick, onComplete) {
    stopTimer();
    remainingDuration = duration;
    onTick();
    timerIntervalId = setInterval(() => {
        if(remainingDuration === 0) {
            onComplete();
            stopTimer();
            return;
        }
        onTick();
        remainingDuration--;
    }, 1000);
}