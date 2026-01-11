# ⭐ URL Favorites - Smart Bookmark Manager

**URL Favorites** is an extension that helps you store, organize, and manage your favorite website links efficiently. Unlike regular bookmarks, this tool allows you to **set reminders**, **take notes**, and **preview website images**.

## ✨ Key Features

### 🚀 Link Management

* **Quick Save:** Add the current website to your favorites list with just one click.

* **Smart Categorization:** Supports pre-defined categories (Work, Study, Entertainment, etc.) and allows **creating custom categories**.

* **Drag & Drop:** Easily prioritize links by dragging and dropping.

* **Search & Filter:** Quickly search by title/URL or filter by category.

### ⏰ Reminders & Notes (Unique Features)
* **Set Reminders:** Never forget to return to an important website. Supports one-time or recurring reminders (Every hour, Every day, Every week...).

* **Personal Notes:** Add detailed notes to each link to remember why you saved it.

* **System Notifications:** Receive browser notifications when reminder times are approaching.

### 🖼️ Intuitive Experience
* **Screenshot:** Automatically capture a screenshot of the webpage when saving to use as a thumbnail.

* **Preview:** Website image preview mode (full-screen zoomable) helps you quickly identify content.

### 💾 Data & Security
* **Offline Storage:** Uses **IndexedDB** directly in the browser, ensuring high speed and security of personal data.

* **Import / Export:** Easily back up and restore your favorites list via a `.json` file.

---

## 📥 Installation Guide

Since this is a development version, you need to manually install it in your browser (Chrome, Edge, Brave, Cốc Cốc...):

1. **Download source code:** Clone the repository or download the ZIP file to your computer and extract it.

```bash

git clone [https://github.com/huynd4104/favorites.git](https://github.com/huynd4104/favorites.git)

```
2. **Open browser:** Access the extension management page:

* **Chrome/Cốc Cốc:** `chrome://extensions/`

* **Edge:** `edge://extensions/`

3. **Enable Developer mode:** Toggle the **"Developer mode"** button in the upper right corner.

4. **Loading the extension:** Click the **"Load unpacked"** button and select the folder containing the project source code.

---

## 📖 User Guide

1. **Save page:** Open the webpage you want to save -> Click the Extension icon -> Click **"⭐ Add to Favorites"**.

2. **Add notes/reminders:**

* In the Favorites list, click the 📝 (Notes) icon.

* Enter the content and enable **"⏰ Set reminder"** if needed.

3. **Manage categories:** Click the **"🗂️ Manage categories"** button at the top of the popup to add/edit/delete your own categories.

4. **Preview:** Click the 👀 (Eye) icon to view a screenshot of the saved webpage.

---

## 🛠 Technologies Used

* **Core:** HTML5, CSS3, JavaScript (ES6+).

* **Storage:** IndexedDB (Stores large amounts of structured data).

* **Chrome APIs:**

* `chrome.storage`: Stores small settings.

* `chrome.notifications`: Displays notification prompts.

* `chrome.tabs` & `chrome.tabCapture`: Interacts with tabs and captures screenshots.

* `chrome.scripting`: Inserts preview scripts into the webpage.

## 📂 Project Structure

* `manifest.json`: Configures permissions and Extension information (Manifest V3).

* `popup.html` & `popup.js`: Main interface and user handling logic.

* `background.js`: Service worker runs in the background to check and send reminder notifications on time.

* `style.css`: User interface.

## 🤝 Contributions
This project was developed by **HuyND (RinNguyen)**. Please submit any feedback by creating an Issue or Pull Request.

## 📄 License
Open Source (MIT License).
