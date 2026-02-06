const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const connectDB = require('../src/db/index');

// Models
const User = require('../src/models/User');
const Post = require('../src/models/Post');
const Comment = require('../src/models/Comment');
const Group = require('../src/models/Group');
const Conversation = require('../src/models/Conversation');
const Message = require('../src/models/Message');
const Notification = require('../src/models/Notification');
const Badge = require('../src/models/Badge');
const BadgeDefinition = require('../src/models/BadgeDefinition');
const Event = require('../src/models/Event');
const DiseasePage = require('../src/models/DiseasePage');
const DiseaseFollower = require('../src/models/DiseaseFollower');
const ForumThread = require('../src/models/ForumThread');
const ForumPost = require('../src/models/ForumPost');
const Gamification = require('../src/models/Gamification');
const BlockedUser = require('../src/models/BlockedUser');
const NotificationPreference = require('../src/models/NotificationPreference');

const DATA_DIR = path.join(__dirname, '..', 'src', 'data');

async function seedData() {
    await connectDB();
    console.log('Connected to MongoDB');

    try {
        await seedCollection('users.json', User);
        await seedCollection('posts.json', Post);
        await seedCollection('comments.json', Comment);
        await seedCollection('groups.json', Group);
        await seedCollection('conversations.json', Conversation);
        await seedCollection('messages.json', Message);
        await seedCollection('notifications.json', Notification);
        await seedCollection('badges.json', Badge);
        await seedCollection('badgeDefinitions.json', BadgeDefinition, 'badgeId'); // keyIdentifier for unique check
        await seedCollection('events.json', Event);
        await seedCollection('diseasePages.json', DiseasePage);
        await seedCollection('diseaseFollowers.json', DiseaseFollower);
        await seedCollection('forumThreads.json', ForumThread);
        await seedCollection('forumPosts.json', ForumPost);
        await seedCollection('gamification.json', Gamification, 'userId');
        await seedCollection('blockedUsers.json', BlockedUser);
        await seedCollection('notificationPreferences.json', NotificationPreference, 'userId');

        console.log('Seeding completed successfully');
        process.exit(0);
    } catch (error) {
        console.error('Seeding failed:', error);
        process.exit(1);
    }
}

async function seedCollection(filename, Model, uniqueKey = '_id') {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) {
        console.log(`Skipping ${filename} (file not found)`);
        return;
    }

    const rawData = fs.readFileSync(filePath, 'utf-8');
    if (!rawData) {
        console.log(`Skipping ${filename} (empty)`);
        return;
    }

    let data;
    try {
        data = JSON.parse(rawData);
    } catch (e) {
        console.log(`Skipping ${filename} (parse error)`);
        return;
    }

    if (!Array.isArray(data) || data.length === 0) {
        console.log(`Skipping ${filename} (no data)`);
        return;
    }

    console.log(`Seeding ${filename} into ${Model.modelName}...`);
    let count = 0;
    for (const item of data) {
        // Determine the unique criteria
        let criteria = {};
        if (uniqueKey === '_id') {
            // For _id, we use the value from JSON 'id' or '_id'
            const id = item.id || item._id;
            if (!id) {
                // If no ID (rare), assume new insert. But most have IDs.
                // blockedUsers might come without IDs if I guessed schema wrong? No, they have UUIDs usually.
                // notificationPreferences has userId.
                // Let's assume 'id' maps to '_id'. 
            }
            criteria = { _id: id };
            // Ensure the object has _id set for the model usage
            if (item.id && !item._id) {
                item._id = item.id;
            }
        } else {
            criteria = { [uniqueKey]: item[uniqueKey] };
        }

        const exists = await Model.findOne(criteria);
        if (!exists) {
            await Model.create(item);
            count++;
        }
    }
    console.log(`Initialized ${count} new ${Model.modelName}(s)`);
}

seedData();
