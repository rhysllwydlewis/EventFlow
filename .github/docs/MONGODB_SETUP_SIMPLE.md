# MongoDB Setup Guide for Non-Technical Users

**Having 502 errors or "connection refused" errors?** This guide helps you set up MongoDB Atlas when you want an external MongoDB provider. No technical experience required.

> **Using Railway MongoDB?** Prefer the Railway-native setup in [Railway Setup Guide](../../docs/guides/RAILWAY_SETUP_GUIDE.md): add a Railway MongoDB service, set `MONGODB_URI` from the service `MONGO_URL` reference, and set `MONGODB_DB_NAME=eventflow`.

## What is MongoDB and Why Do I Need It?

MongoDB is a database - think of it as a secure place in the cloud where your app stores all its data (users, events, messages, etc.). Your EventFlow app needs this to work in production.

The **free tier is completely free forever** - you don't need a credit card.

## Step-by-Step Setup (15 minutes)

### Step 1: Create Your Free MongoDB Atlas Account

1. Go to **https://cloud.mongodb.com/** in your web browser
2. Click the big **"Try Free"** or **"Start Free"** button
3. Fill in:
   - Your email address (use one you can access)
   - Create a password (write it down!)
   - First and last name
4. Click **"Create your Atlas account"**
5. Check your email and click the verification link they send you

**✅ Done!** You now have a MongoDB Atlas account.

---

### Step 2: Create Your First Cluster (Database Server)

After logging in, you'll see a setup wizard:

1. **Choose Your Plan:**
   - Select **"M0 FREE"** (this is the free tier - no credit card needed)
   - Keep the default settings selected
   - Click **"Create"** or **"Create Deployment"**

2. **Choose Your Cloud & Region:**
   - **Provider:** Choose **AWS** (recommended) or any other
   - **Region:** Choose the one closest to where your users are
     - Example: If you're in the UK, choose `eu-west-2 (London)`
     - Example: If you're in the US, choose `us-east-1 (N. Virginia)`
   - Click **"Create Cluster"** or **"Create"**

3. **Wait a moment:** The cluster takes 1-3 minutes to create. You'll see a progress indicator.

**✅ Done!** Your database server is being created.

---

### Step 3: Create a Database User (Login for Your App)

While the cluster is creating, set up a user:

1. You should see a popup titled **"Security Quickstart"** or find **"Database Access"** in the left menu
2. Click **"Add a Database User"** or you might already be in this screen
3. Fill in the form:
   - **Username:** Choose something simple like `eventflowuser` (no spaces)
   - **Password:** Click **"Autogenerate Secure Password"**
   - **IMPORTANT:** Click the **"Copy"** button next to the password and save it somewhere safe!
   - Or create your own strong password (letters, numbers, symbols - no spaces)
4. **Database User Privileges:** Keep it as **"Read and write to any database"** (default)
5. Click **"Add User"**

**✅ Done!** You now have a database user. Keep that password safe!

---

### Step 4: Allow Access from Your Deployment Platform

Your app needs permission to connect to your database:

1. In the same security quickstart, or click **"Network Access"** in the left sidebar
2. Click **"Add IP Address"**
3. You have two options:

   **Option A - Allow from Anywhere (Easiest for beginners):**
   - Click the button **"Allow Access from Anywhere"**
   - This adds `0.0.0.0/0` to the IP Access List
   - Click **"Confirm"**
   - ⚠️ Note: This is fine for learning/testing but add specific IPs for production

   **Option B - Add Your Deployment Platform's IP (More Secure):**
   - For **Railway:** They don't use fixed IPs, so use Option A above
   - For **Heroku:** Get your app's IP addresses from Heroku settings
   - For **other platforms:** Check their documentation for outbound IP addresses
   - Enter the IP address and click **"Add Entry"**

4. Wait 1-2 minutes for the changes to take effect

**✅ Done!** Your database now accepts connections.

---

### Step 5: Get Your Connection String

This is the "address" your app uses to connect to MongoDB:

1. Go back to the main **"Database"** view (click "Database" in left menu)
2. Find your cluster (usually named `Cluster0`)
3. Click the **"Connect"** button (looks like a plug or has "Connect" text)
4. Choose **"Connect your application"** (might say "Drivers")
5. Make sure it says:
   - **Driver:** Node.js
   - **Version:** 5.5 or later (any recent version is fine)
6. You'll see a connection string that looks like:
   ```
   mongodb+srv://eventflowuser:<password>@cluster0.abcd1.mongodb.net/?retryWrites=true&w=majority
   ```
7. Click the **"Copy"** button next to the connection string

**✅ Done!** You have your connection string.

---

### Step 6: Update Your Connection String

The connection string has a placeholder `<password>` that you need to replace:

1. Open a text editor (Notepad, TextEdit, or any text app)
2. Paste your connection string
3. Find `<password>` (including the `<` and `>` brackets)
4. Replace the entire thing `<password>` with the actual password you saved in Step 3
   - If your password was `MySecurePass123`, change this:
     ```
     mongodb+srv://eventflowuser:<password>@cluster0...
     ```
     to this:
     ```
     mongodb+srv://<YOUR-USERNAME>:<YOUR-PASSWORD>@<YOUR-CLUSTER>...
     ```
5. Make sure there are NO `<` or `>` brackets left
6. Copy the complete connection string

**✅ Done!** Your connection string is ready to use.

---

### Step 7: Add Connection String to Your Deployment

Now add this to your deployment platform:

#### For Railway with Atlas:

If you are using Railway's own MongoDB service, use the [Railway Setup Guide](../../docs/guides/RAILWAY_SETUP_GUIDE.md) instead. If you are intentionally using Atlas from Railway:

1. Go to your Railway project dashboard: **https://railway.app/**
2. Click on your EventFlow service/app
3. Click on the **"Variables"** tab at the top
4. Click **"+ New Variable"**
5. Enter:
   - **Variable name:** `MONGODB_URI`
   - **Value:** Paste your complete connection string (the one with your actual password)
6. Add another variable:
   - **Variable name:** `MONGODB_DB_NAME`
   - **Value:** `eventflow`
7. Click **"Add"** or press Enter
8. Your app will automatically redeploy with the new configuration

#### For Heroku:

1. Go to your Heroku dashboard: **https://dashboard.heroku.com/**
2. Click on your app
3. Click **"Settings"** tab
4. Scroll down to **"Config Vars"**
5. Click **"Reveal Config Vars"**
6. Add a new variable:
   - **KEY:** `MONGODB_URI`
   - **VALUE:** Paste your complete connection string
7. Click **"Add"**

#### For Other Platforms:

Look for "Environment Variables" or "Config Vars" in your platform's settings and add:

- Name/Key: `MONGODB_URI`
- Value: Your complete connection string

**✅ Done!** Your app now knows how to connect to MongoDB.

---

### Step 8: Verify It's Working

Wait 1-2 minutes for your app to restart, then:

1. Visit your app's URL (e.g., `https://your-app.railway.app`)
2. You should see your app load without errors!
3. To double-check, visit: `https://your-app.railway.app/api/health`
   - You should see MongoDB reported as connected and `activeBackend` set to `mongodb`

**🎉 Congratulations!** Your app is now connected to MongoDB and running properly!

---

## Common Problems and Solutions

### Problem: "Invalid scheme, expected connection string to start with..."

**Cause:** You're still using the example/placeholder connection string.

**Solution:**

- Make sure you followed Step 5 to get YOUR actual connection string from MongoDB Atlas
- Don't use the example from `.env.example`

---

### Problem: "Authentication failed" or "bad auth"

**Cause:** The password in your connection string is wrong.

**Solution:**

1. Go to MongoDB Atlas → Database Access
2. Click on your user
3. Click "Edit"
4. Click "Edit Password"
5. Generate a new password, copy it
6. Update your MONGODB_URI with the new password (Step 6 above)
7. Redeploy your app

---

### Problem: "Connection timeout" or "Cannot reach MongoDB server"

**Cause:** Your deployment platform's IP address is not whitelisted.

**Solution:**

1. Go to MongoDB Atlas → Network Access
2. If you don't see `0.0.0.0/0`, add it (see Step 4)
3. Wait 1-2 minutes and try again

---

### Problem: Still seeing 502 errors

**Cause:** Multiple possibilities.

**Solution - Check these:**

1. Visit `https://your-app.railway.app/api/health`
   - Check that MongoDB is connected and `activeBackend` is `mongodb`
2. Check your deployment logs:
   - Railway: Click your service → "Deployments" tab → Click latest deployment → "View Logs"
   - Heroku: Click your app → "More" → "View logs"
3. Look for errors starting with "❌"
4. Make sure your `MONGODB_URI` environment variable is actually set
5. Make sure there are no extra spaces before or after the connection string

---

### Problem: "Database user exists" or name taken

**Cause:** Username already taken in your account.

**Solution:**

- Choose a different username like `eventflowuser2` in Step 3

---

## Need More Help?

1. **Check your deployment logs** - they'll tell you exactly what's wrong
2. **MongoDB Atlas documentation:** https://www.mongodb.com/docs/atlas/getting-started/
3. **Create an issue:** https://github.com/rhysllwydlewis/eventflow/issues
4. Include in your issue:
   - The error message you're seeing (from logs)
   - What step you're stuck on
   - Don't include your password or full connection string!

---

## Security Tips

✅ **DO:**

- Use a strong, unique password for your database user
- Keep your connection string secret (don't share it publicly)
- Regularly check who has access to your MongoDB cluster

❌ **DON'T:**

- Share your password or connection string publicly
- Commit the connection string to Git/GitHub
- Use simple passwords like "password123"

---

## Summary Checklist

Before you start:

- [ ] I have 15 minutes
- [ ] I have access to my email
- [ ] I know my deployment platform (Railway, Heroku, etc.)

Steps completed:

- [ ] Created MongoDB Atlas account
- [ ] Created a free M0 cluster
- [ ] Created a database user and saved the password
- [ ] Allowed access from anywhere (0.0.0.0/0)
- [ ] Got my connection string
- [ ] Replaced `<password>` with my actual password
- [ ] Added MONGODB_URI to my deployment platform
- [ ] Verified my app works at the /api/health endpoint

---

**Last updated:** 2025-12-11  
**Guide version:** 1.0

_This guide is designed for people with no technical background. If anything is unclear, please let us know so we can improve it!_
