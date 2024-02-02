const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 5000;

// cors
app.use(cors({
    origin: "*"
}))

// Replace these values with your proxy information
const proxyHost = '172.31.2.4';
const proxyPort = 8080;
const proxyUsername = 'iec2020098';
const proxyPassword = 'Bimlap@nda54';
const proxyUrl = `https://${proxyUsername}:${proxyPassword}@${proxyHost}:${proxyPort}`;

// Create an instance of the HttpsProxyAgent with authentication
const agent = new HttpsProxyAgent(proxyUrl);

app.use(bodyParser.json());

mongoose.connect('mongodb://localhost:27017/hackernews', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})//.then(() => (updateDatabase()));

const newsSchema = new mongoose.Schema({
    hackerNewsId: Number,
    title: String,
    url: String,
    postedOn: String,
    upvotes: Number,
    comments: Number,
    isRead: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});
const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
});

const News = mongoose.model('News', newsSchema);
const User = mongoose.model('User', userSchema);

const fetchHackerNews = async (userId) => {
    console.log('fetching started');
    try {
        const top90News = await axios.get(
            'https://hacker-news.firebaseio.com/v0/topstories.json'
        );
        const storyIds = top90News.data.slice(0, 90);

        const newsItems = [];

        for (const storyId of storyIds) {
            const response = await axios.get(
                `https://hacker-news.firebaseio.com/v0/item/${storyId}.json`
            );

            const item = response.data;

            // Check if the item is a story and not a different type (e.g., poll)
            if (item && item.type === 'story') {
                const newsItem = {
                    hackerNewsId: item.id,
                    title: item.title,
                    url: item.url,
                    postedOn: new Date(item.time * 1000).toLocaleString(),
                    upvotes: item.score,
                    comments: item.descendants || 0,
                    isRead: false, // Initialize isRead as false by default
                    isDeleted: false, // Initialize isDeleted as false by default
                    createdBy: userId,
                };

                newsItems.push(newsItem);
            }
        }
        console.log('fetching done');
        return newsItems;
    } catch (error) {
        console.error('Error fetching Hacker News:', error);
        throw error;
    }
};

const updateDatabase = async (userId) => {
    try {
        const hackerNewsData = await fetchHackerNews(userId);

        for (const item of hackerNewsData) {
            await News.findOneAndUpdate({ hackerNewsId: item.hackerNewsId }, item, {
                upsert: true,
                new: true,
            });
        }

        console.log('Database updated successfully');
    } catch (error) {
        console.error('Error updating database:', error);
    }
};

// middlewares
const verifyToken = (req, res, next) => {
    const token = req.header('Authorization').split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const decoded = jwt.verify(token, 'anuragrohit');
        req.userId = decoded.userId;
        next();
    } catch (error) {
        console.error('Error verifying token:', error);
        res.status(401).json({ error: 'Unauthorized' });
    }
};

// routes
app.post('/api/signup', async (req, res) => {
    const { username, password } = req.body;

    try {
        const newUser = new User({ username, password });
        await newUser.save();

        // Generate JWT token for the new user
        const token = jwt.sign({ userId: newUser._id }, 'anuragrohit');

        res.status(201).json({ token });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const user = await User.findOne({ username, password });

        if (user) {
            // Generate JWT token
            const token = jwt.sign({ userId: user._id }, 'anuragrohit');
            res.json({ token });
        } else {
            res.status(401).json({ error: 'Invalid credentials.' });
        }
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/api/fetch-and-filter', verifyToken, async (req, res) => {
    try {
        // Fetch and update the database when the API is called
        await updateDatabase(req.userId);

        const top90News = await News.find({ isDeleted: false, createdBy: req.userId })
            .sort({ upvotes: -1, postedOn: -1 })
            .limit(90)
            .lean();

        res.json(top90News);
    } catch (error) {
        console.error('Error fetching and filtering news:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.put('/api/mark-as-read/:id', verifyToken, async (req, res) => {
    const { id } = req.params;

    try {
        await News.findByIdAndUpdate({ _id: id, createdBy: req.userId }, { isRead: true });
        const updatedNews = await News.find({ isDeleted: false, createdBy: req.userId })
            .sort({ upvotes: -1, postedOn: -1 })
            .limit(90)
            .lean();

        res.json(updatedNews);
    } catch (error) {
        console.error('Error marking as read:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.delete('/api/mark-as-deleted/:id', verifyToken, async (req, res) => {
    const { id } = req.params;

    try {
        await News.findByIdAndUpdate({ _id: id, createdBy: req.userId }, { isDeleted: true });
        const updatedNews = await News.find({ isDeleted: false, createdBy: req.userId })
            .sort({ upvotes: -1, postedOn: -1 })
            .limit(90)
            .lean();

        res.json(updatedNews);
    } catch (error) {
        console.error('Error marking as deleted:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
