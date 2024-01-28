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

function findWaitingPlayers() {
    let waitingInfo = [];
    for (const [roomName, game] of Object.entries(games)) {
        console.log(`Room: ${roomName}, Players: ${Object.keys(game.players).length}`);
        if (Object.keys(game.players).length === 1) {
            const waitingPlayerName = Object.values(game.players)[0];
            if (game.gameSettings) {
                const { selectedMode, numQuestions, isLeagueMatch } = game.gameSettings;
                waitingInfo.push({
                    roomName,
                    playerName: waitingPlayerName,
                    gameSettings: {
                        selectedMode,
                        numQuestions,
                        isLeagueMatch
                    }
                });
            } else {
                waitingInfo.push({
                    roomName,
                    playerName: waitingPlayerName,
                    gameSettings: null
                });
            }
        }
    }
    return waitingInfo;
}
const playerSockets = {}; // New object to map player names to socket IDs

io.on('connection', (socket) => {
    console.log(`A user connected. Socket ID: ${socket.id}`);

    setTimeout(() => {
    const waitingPlayers = findWaitingPlayers();
    if (waitingPlayers.length > 0) {
        waitingPlayers.forEach(({ roomName, playerName, gameSettings }) => {
            let settingsDescription = gameSettings && gameSettings.isLeagueMatch ? 
                                          "League Match" : 
                                          `Number of Questions: ${gameSettings ? gameSettings.numQuestions : ''}`;
            let modeDescription = gameSettings ? gameSettings.selectedMode : '';
            socket.emit('playerWaiting', `${playerName} is waiting in ${roomName} - Mode: ${modeDescription}, Settings: ${settingsDescription}`);
        });
    }
}, 3000);

socket.on('joinRoom', (roomName, playerName) => {
    console.log(`Player ${playerName} attempting to join room: ${roomName}`);
    playerSockets[playerName] = socket.id;
        console.log(`Player ${playerName} mapped to socket ID: ${socket.id}`);
        socket.join(roomName);

        if (!games[roomName]) {
            games[roomName] = {
                players: {},
                questions: [],
                playerQuestionIndices: {},
                scores: {},
                gameStarted: false,  // Track if the game has started
                gameSettings: {}
            };
        }

        if (!(playerName in games[roomName].playerQuestionIndices)) {
            games[roomName].playerQuestionIndices[playerName] = 0;
        }

        if (games[roomName].players[playerName]) {
        console.log(`Player ${playerName} rejoining room ${roomName}`);

        io.to(playerSockets[playerName]).emit('playerRejoined', playerName)
        } else {
            console.log(`Player ${playerName} joined room ${roomName}. Players in room: ${Object.keys(games[roomName].players)}`);
            games[roomName].players[playerName] = playerName;
            games[roomName].scores[playerName] = 0; 

            games[roomName].playerQuestionIndices[playerName] = 0;
        }

        socket.join(roomName);

        if (Object.keys(games[roomName].players).length === 1) {
            socket.emit('waitingForPlayer', 'Room joined, waiting for player 2');
        } else if (Object.keys(games[roomName].players).length === 2 && !games[roomName].gameStarted) {
            startGame(roomName);  // Start the game if two players are present and the game hasn't started
        }
    });

    socket.on('startGame', (roomName, gameSettings) => {
        if (!games[roomName] || games[roomName].gameStarted) {
            return;
        }
        
        games[roomName].gameSettings = gameSettings || {}; // Fallback to an empty object if undefined
    
        if (games[roomName].gameSettings.isLeagueMatch) {
            games[roomName].leagueMatch = true;
            games[roomName].startTime = Date.now();
        }
    });

    socket.on('requestCurrentGameState', (roomName, playerName) => {
        console.log(`Current game state requested by ${playerName} in room ${roomName}`);
        if (games[roomName] && games[roomName].players[playerName]) {
            const playerSocketId = playerSockets[playerName];
            const gameStartTime = games[roomName].startTime;
            
            console.log('Game Start Time:', gameStartTime); // Additional log for start time
            const currentTime = Date.now(); 
            console.log('Current Time:', Date.now()); // Log current time
    
            // Make sure the start time is a number and is in the past.
            if (typeof gameStartTime === 'number' && gameStartTime <= Date.now()) {
                const elapsedTime = Math.round((Date.now() - gameStartTime) / 1000);
                console.log('Elapsed Time Calculated:', elapsedTime); // Log the calculated elapsed time
                
                const gameState = {
                    scores: games[roomName].scores,
                    nextQuestion: getNextQuestion(roomName, playerName),
                    elapsedTime: elapsedTime,
                    timeLeftForNextQuestion: 30,
                    startTime: gameStartTime,
                    gameStarted: games[roomName].gameStarted
                };
                
                console.log(`Sending current game state to ${playerName} (Socket ID: ${playerSocketId}):`, gameState);
                io.to(playerSocketId).emit('currentGameState', gameState);
            } else {
                console.error(`Invalid game start time for room ${roomName}. Start time:`, gameStartTime);
                // Handle the error case here, such as by emitting an error message to the client.
            }
        } else {
            console.log(`Game or player not found for ${playerName} in room ${roomName}`);
        }
    });

    socket.on('submitAnswer', (roomName, submittedAnswer, playerName) => {
        const game = games[roomName];
        if (!game || !game.players[playerName]) {
            return;
        }
    
        const playerIndex = game.playerQuestionIndices[playerName];
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
            game.scores[playerName]++;
            game.playerQuestionIndices[playerName]++;
            if (game.playerQuestionIndices[playerName] < game.questions.length) {
                sendQuestionToPlayer(roomName, playerName, game.playerQuestionIndices[playerName]);
            } else {
            }
        }
    
    
        const updatedScores = {};
    for (const [name, score] of Object.entries(game.scores)) {
        updatedScores[name] = score;
    }

    io.to(roomName).emit('scoreUpdate', updatedScores);
    console.log(`Player ${playerName} submitted an answer in room ${roomName}. Current score: ${game.scores[playerName]}`);
}); 

socket.on('timerExpired', (roomName, playerName) => {
    const game = games[roomName];
    if (!game) {
        return;
    }

    if (!game.playerQuestionIndices[playerName] && game.playerQuestionIndices[playerName] !== 0) {
        return;
    }

    if (game.playerQuestionIndices[playerName] >= game.questions.length) {
        return;
    }
    game.playerQuestionIndices[playerName]++;
    
    if (game.playerQuestionIndices[playerName] < game.questions.length) {
        sendQuestionToPlayer(roomName, playerName, game.playerQuestionIndices[playerName]);
    } else {
    }

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
            game.startTime = Date.now();  // Set the start time for the league match
            console.log(`Game started in room ${roomName}. Start time: ${game.startTime}`);
            
            io.to(roomName).emit('gameStarted', { startTime: game.startTime });
        }

        sendQuestionToRoom(roomName); // Send the first question to all clients in the room
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

function sendQuestionToPlayer(roomName, playerName, questionIndex) {
    const game = games[roomName];
    if (game && questionIndex < game.questions.length) {
        const question = game.questions[questionIndex];
        const socketId = playerSockets[playerName];
        if (socketId) {
            io.to(socketId).emit('newQuestion', question);
            console.log(`Question sent to player: ${playerName}, Room: ${roomName}, Question Index: ${questionIndex}`);
        } else {
            console.log(`Error: Socket ID not found for player: ${playerName}`);
        }
    } else {
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

function getNextQuestion(roomName, playerName) {
    const game = games[roomName];
    if (!game || !game.questions || !game.playerQuestionIndices[playerName]) {
        return null; // Handle cases where game or player index is not found
    }
    const questionIndex = game.playerQuestionIndices[playerName];
    return game.questions[questionIndex];
}

function calculateElapsedTime(startTime) {
    if (!startTime) {
        return 0;
    }
    return Math.round((Date.now() - startTime) / 1000);
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

    const results = {};
    for (const playerId in game.scores) {
        const playerName = game.players[playerId];
        results[playerName] = game.scores[playerId];
    }

    const winner = Object.keys(game.scores).reduce((a, b) => game.scores[a] > game.scores[b] ? a : b);
    results['winner'] = game.players[winner];

    io.to(roomName).emit('endGame', results);
}

function calculateResults(game) {
}

server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);});