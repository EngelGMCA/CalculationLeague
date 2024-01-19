const http = require('http');
const fs = require('fs');
const socketIo = require('socket.io');
const questionFormats = require('./questionFormats');

const port = 3000;
const server = http.createServer((req, res) => {
    fs.readFile('index.html', (err, data) => {
        if (err) {
            res.writeHead(500);
            return res.end('Error loading index.html');
        }
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.end(data);
    });
});

const io = socketIo(server);

const games = {}; // Store game state for each room

io.on('connection', (socket) => {
    console.log('A user connected');

    socket.on('joinRoom', (roomName, playerName) => {
        socket.join(roomName);

        if (!games[roomName]) {
            games[roomName] = {
                players: {},
                questions: [],
                playerQuestionIndices: {},
                scores: {},
                gameStarted: false  // Track if the game has started
            };
        }
        games[roomName].players[socket.id] = playerName;
        games[roomName].scores[socket.id] = 0; // Initialize score

        if (Object.keys(games[roomName].players).length === 1) {
            socket.emit('waitingForPlayer', 'Room joined, waiting for player 2');
        }
        games[roomName].playerQuestionIndices[socket.id] = 0;

        if (Object.keys(games[roomName].players).length === 2) {
            startGame(roomName);  // Call startGame here
        }
    });

    socket.on('startGame', (roomName, gameSettings) => {
        if (!games[roomName]) {
            return;
        }
        
        games[roomName].gameSettings = gameSettings || {}; // Fallback to an empty object if undefined
    
        if (games[roomName].gameSettings.isLeagueMatch) {
            games[roomName].leagueMatch = true;
            games[roomName].startTime = Date.now();
        }
    });

    socket.on('submitAnswer', (roomName, submittedAnswer, playerId) => {
        const game = games[roomName];
        if (!game) {
            return;
        }
    
        const playerIndex = game.playerQuestionIndices[playerId];
        if (playerIndex >= game.questions.length) {
            return;
        }
    
        const currentQuestion = game.questions[playerIndex];
        const correctAnswer = currentQuestion.answer;
        let tolerance;
    
        if (correctAnswer >= -1 && correctAnswer <= 1) {
            tolerance = 0.005;
        } else if ((correctAnswer >= -10 && correctAnswer < -1) || (correctAnswer > 1 && correctAnswer <= 10)) {
            tolerance = 0.05;
        } else {
            tolerance = 0.5;
        }
    
        if (Math.abs(submittedAnswer - correctAnswer) <= tolerance) {
            game.scores[playerId]++;
            game.playerQuestionIndices[playerId]++;
            sendQuestionToPlayer(roomName, playerId, game.playerQuestionIndices[playerId]);
        }
    
        // Update scores but don't send a new question if the answer is incorrect
        const updatedScores = {};
        for (const [playerSocketId, score] of Object.entries(game.scores)) {
            const playerName = game.players[playerSocketId];
            updatedScores[playerName] = score;
        }
    
        io.to(roomName).emit('scoreUpdate', updatedScores);
    }); 

socket.on('timerExpired', (roomName, playerId) => {
    const game = games[roomName];
    if (!game || game.playerQuestionIndices[playerId] >= game.questions.length - 1) {
        return;
    }

    game.playerQuestionIndices[playerId]++;
    sendQuestionToPlayer(roomName, playerId, game.playerQuestionIndices[playerId]);

    checkGameOver(roomName);
});
});

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function startGame(roomName) {
    const game = games[roomName];
    if (game && !game.gameStarted && Object.keys(game.players).length === 2) {
        const settings = game.gameSettings || {};
        
        let numQuestions = settings.isLeagueMatch ? 500 : settings.numQuestions || 10;
        game.questions = generateQuestionsForRoom(settings.selectedMode, numQuestions);

        game.gameStarted = true;
        game.leagueMatch = settings.isLeagueMatch;
        if (game.leagueMatch) {
            game.startTime = Date.now();  // Start time for league match
        }

        sendQuestionToRoom(roomName);
    } 
}

function generateQuestionsForRoom(mode, numQuestions) {
    let questions = [];
    for (let i = 0; i < numQuestions; i++) {
        questions.push(generateQuestion(mode));
    }
    return questions;
}
function generateQuestion(mode) {
    let difficulty;
    switch (mode) {
        case 'qualification':
            difficulty = 'easy';
            break;
        case 'regularSeason':
            difficulty = Math.random() < 0.75 ? 'easy' : 'medium';
            break;
            case 'playoffs':
            let playoffsRandom = Math.random();
            if (playoffsRandom < 0.5) {
                difficulty = 'easy';
            } else if (playoffsRandom < 0.75) {
                difficulty = 'medium';
            } else {
                difficulty = 'difficult';
            }
            break;
        case 'finals':
            let finalsRandom = Math.random();
            if (finalsRandom < 0.25) {
                difficulty = 'easy';
            } else if (finalsRandom < 0.75) {
                difficulty = 'medium';
            } else {
                difficulty = 'difficult';
            }
            break;
    }

    if (Math.random() < 0.35) {
        return getRandomQuestionFromList(difficulty);
    } else {
        let questionData = generateRandomQuestion(difficulty);
        questionData.isFromList = false; // Indicate that the question is not from the list
        return questionData;
    }
}
function getRandomQuestionFromList(difficulty) {
    let questionFormat;
    if (difficulty === 'easy') {
        questionFormat = questionFormats.easy[Math.floor(Math.random() * questionFormats.easy.length)];
    } else if (difficulty === 'medium') {
        questionFormat = questionFormats.medium[Math.floor(Math.random() * questionFormats.medium.length)];
    } else if (difficulty === 'difficult') {
        questionFormat = questionFormats.difficult[Math.floor(Math.random() * questionFormats.difficult.length)];
    }

    let displayQuestion = questionFormat.format; // The question as it will be displayed
    let calculationQuestion = displayQuestion.replace(/\^/g, '**'); // The question for calculation

    for (const variable in questionFormat.ranges) {
        const value = getRandomInt(questionFormat.ranges[variable][0], questionFormat.ranges[variable][1]);
        displayQuestion = displayQuestion.replace(new RegExp(variable, 'g'), value);
        calculationQuestion = calculationQuestion.replace(new RegExp(variable, 'g'), value);
    }

    try {
        let answer = eval(calculationQuestion);
        return { text: displayQuestion, answer, isFromList: true }; // Indicate that the question is from the list
    } catch (error) {
        return { text: "Error generating question", answer: 0 };
    }
}

function generateRandomQuestion(difficulty) {
    let numOperations = getRandomInt(2, 10);
    let questionParts = [];
    let calculationParts = [];
    let openParenthesis = false;
    let currentSum = 0;
    let range = difficulty === 'easy' ? [1, 9] : difficulty === 'medium' ? [10, 99] : [100, 999];

    for (let i = 0; i < numOperations; i++) {
        let operation = ['+', '-', '*', '/'][getRandomInt(0, 3)];
        let value;

        if (operation === '+' || operation === '-') {
            if (!openParenthesis) {
                questionParts.push('(');
                calculationParts.push('(');
                openParenthesis = true;
                currentSum = 0;
            }

            do {
                value = getRandomInt(...range);
                if (operation === '-') value = -value;
            } while (currentSum + value === 0 || (i === numOperations - 1 && currentSum + value - getRandomInt(...range) === 0));

            currentSum += value;
            if (value < 0) {
                operation = '-';
                value = -value;
            } else {
                operation = '+';
            }
        } else {
            value = getRandomInt(...range);
        }

        questionParts.push(value);
        calculationParts.push(value);

        if ((operation === '*' || operation === '/') && openParenthesis) {
            questionParts.push(')');
            calculationParts.push(')');
            openParenthesis = false;
        }

        questionParts.push(operation);
        calculationParts.push(operation);
    }

    let lastValue = getRandomInt(...range);
    questionParts.push(lastValue);
    calculationParts.push(lastValue);

    if (openParenthesis) {
        questionParts.push(')');
        calculationParts.push(')');
    }

    let question = questionParts.join(' ').trim();
    let calculationQuestion = calculationParts.join('').trim();
    let answer;
    try {
        answer = eval(calculationQuestion);
        if (!isFinite(answer)) { // Check for Infinity or -Infinity which indicates division by zero
            answer = 0;
        }
    } catch (e) {
        answer = 0; // Set the answer to 0 in case of an error
    }
    return { text: question, answer };
}

function sendQuestionToPlayer(roomName, playerId, questionIndex) {
    const game = games[roomName];
    if (game && questionIndex < game.questions.length) {
        const question = game.questions[questionIndex];
        io.to(playerId).emit('newQuestion', question);
    }
}

function sendQuestionToRoom(roomName) {
    const game = games[roomName];
    if (game) {
        for (const playerId in game.playerQuestionIndices) {
            sendQuestionToPlayer(roomName, playerId, game.playerQuestionIndices[playerId]);
        }
    }
}
function checkGameOver(roomName) {
    const game = games[roomName];
    if (!game) {
        return;
    }
    if (game.leagueMatch) {
        const timeElapsed = (Date.now() - game.startTime) / 1000;
        const scoreDifference = Math.abs(game.scores[Object.keys(game.scores)[0]] - game.scores[Object.keys(game.scores)[1]]);
        if (scoreDifference >= 50 || timeElapsed >= 1800) {
            endGameInRoom(roomName);
}
} else {
    let allPlayersCompleted = Object.values(game.playerQuestionIndices).every(index => index >= game.questions.length);

    if (allPlayersCompleted) {
        endGameInRoom(roomName);
    }
}
}

function endGameInRoom(roomName) {
    const game = games[roomName];
    if (!game) {
        return;
    }

    // Preparing the results object
    const results = {};
    for (const playerId in game.scores) {
        const playerName = game.players[playerId];
        results[playerName] = game.scores[playerId];
    }

    const winner = Object.keys(game.scores).reduce((a, b) => game.scores[a] > game.scores[b] ? a : b);
    results['winner'] = game.players[winner];

    // Sending the results object to all clients in the room
    io.to(roomName).emit('endGame', results);
}

function calculateResults(game) {
}

server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
});