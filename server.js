const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "http://localhost:5173", // Default Vite dev server port
        methods: ["GET", "POST"]
    }
});

// Animal state management
const animalState = {
    isHungry: true,
    isThirsty: true,
    isDirty: true,
    hasWaste: true,
    isBusy: false,
    lastUpdate: {
        fed: null,
        drink: null,
        wash: null,
        clean: null
    }
};

// Store connected visitors on Set()(unique)
const visitors = new Set();

//animal busy state (1 second)
const setBusyState = () => {
    animalState.isBusy = true;
    io.emit('animal_state_update', animalState);
    
    setTimeout(() => {
        animalState.isBusy = false;
        io.emit('animal_state_update', animalState);
    }, 1000); 
};

// Reset animal state after delay (5 seconds)
const resetStateAfterDelay = (stateKey) => {
    setTimeout(() => {
        animalState[stateKey] = true;
        animalState.lastUpdate[stateKey] = null;
        io.emit('animal_state_update', animalState);
    }, 5000);
};

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Send initial animal state
    socket.emit('animal_state_update', animalState);

    // Handle visitor joining
    socket.on('join_room', (visitorName) => {
        socket.visitorName = visitorName;
        visitors.add(visitorName);
        io.emit('visitor_joined', Array.from(visitors));
        io.emit('chat_message', {
            type: 'system',
            message: `${visitorName} has joined the zoo!`
        });
    });

    // Handle chat messages
    socket.on('send_message', (message) => {
        io.emit('chat_message', {
            type: 'user',
            user: socket.visitorName,
            message: message
        });
    });

    // Handle animal interactions
    socket.on('interact_animal', (action) => {
        // Check if animal is busy
        if (animalState.isBusy) {
            socket.emit('interaction_failed', 'The animal is busy!');
            return;
        }
    
        // Set busy state immediately
        setBusyState();
    
        switch(action) {
            case 'feed':
                animalState.isHungry = false;
                animalState.lastUpdate.fed = new Date();
                resetStateAfterDelay('isHungry');
                break;
            case 'drink':
                animalState.isThirsty = false;
                animalState.lastUpdate.drink = new Date();
                resetStateAfterDelay('isThirsty');
                break;
            case 'wash':
                animalState.isDirty = false;
                animalState.lastUpdate.wash = new Date();
                resetStateAfterDelay('isDirty');
                break;
            case 'clean':
                animalState.hasWaste = false;
                animalState.lastUpdate.clean = new Date();
                resetStateAfterDelay('hasWaste');
                break;
        }
    
        io.emit('animal_state_update', animalState);
        io.emit('interaction_event', {
            user: socket.visitorName,
            action: action
        });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        if (socket.visitorName) {
            visitors.delete(socket.visitorName);
            io.emit('visitor_joined', Array.from(visitors));
            io.emit('chat_message', {
                type: 'system',
                message: `${socket.visitorName} has left the zoo!`
            });
        }
    });
});

// Basic health check route
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});