# Almuntazar Academy

A web application for running Almuntazar Academy across all of its locations: classes and teachers, session logs and attendance, follow-up of absent students, weekly coordination calls, the question bank and online exams, results and certificates, teaching materials, teacher training and weekly Quran and book reading.

It is built from the clickable prototype, kept in [`docs/prototype.html`](docs/prototype.html). Every screen from the prototype is here. Data is kept in a database, each person signs in with their own account, and exams are marked on the server.

## Who uses it

| Role | What they do |
| --- | --- |
| **Super admin** | Sees every location side by side. Adds locations, course types, subjects, teachers and user accounts. Runs reports, including a custom report builder with CSV download. |
| **Academic team** | Maintains the syllabus chart, the question bank (six question types, plus importing a question paper), exam windows, the materials library, weekly reading targets, teacher access levels, teacher training and the traditions library. |
| **Location responsible** (primary or secondary) | Runs one location: creates classes and assigns teachers, chases unlogged sessions, reviews and publishes results, records the weekly coordination call and tracks action items. |
| **Coordinator** | Allocates new registrations to classes, creates classes (which wait for a teacher to be assigned), and follows their own action items. |
| **Teacher** | Sees the next class and this week's lesson, logs sessions and attendance, sees students who need attention, shares materials with a class, and replies to training invitations. |
| **Student** | Sees the next class in their own time zone, logs weekly reading, takes exams, sees published results and certificates, and opens shared materials. A student who is their class's **class assistant** can also log sessions. |

## Running it

You need **Node.js 22.13 or newer**. The database is SQLite, which is built into Node, so nothing else needs installing.

```bash
npm install
npm start
```

Then open http://localhost:3000.

The first time it starts with an empty database, it loads the same sample data as the prototype (six locations, with Mumbai fully populated). The sample dates are moved forward to the current week, so the data always looks recent.

### Sample accounts

All sample accounts use the password **`almuntazar123`** (set `SEED_PASSWORD` before the first start to choose another). The sign-in page lists them.

| Username | Person | Role |
| --- | --- | --- |
| `abbas` | Br. Abbas | Super admin |
| `tahera` | Sr. Tahera | Academic team |
| `jafar` | Br. Jafar | Primary responsible, Mumbai |
| `kazim` | Br. Kazim | Secondary responsible, Mumbai |
| `sabiha` | Sr. Sabiha | Coordinator, Mumbai |
| `maryam` | Sr. Maryam | Teacher |
| `zainab` | Zainab H. | Student and class assistant |

**Before going live:** reset every sample password under *User accounts*, or start with an empty database (`SEED=0`) and create the real accounts. To hide the sample-account list on the sign-in page, set `DEMO=0`.

### Commands

| Command | What it does |
| --- | --- |
| `npm start` | Starts the server. |
| `npm run dev` | Starts the server and restarts it when a file changes. |
| `npm test` | Runs the server tests. |
| `npm run seed -- --reset` | Wipes the database and loads the sample data again. |

### Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on. |
| `DATA_DIR` | `./data` | Where the database (`academy.db`) and uploaded files are kept. Back this folder up. |
| `SEED` | on | Set to `0` to start with an empty database instead of the sample data. |
| `SEED_PASSWORD` | `almuntazar123` | Password given to the sample accounts. |
| `DEMO` | on | Set to `0` to hide the sample accounts and the sample-data notice. |
| `APP_TZ` | `Asia/Kolkata` | Time zone used to decide today's date. Class times are entered in India time. |
| `APP_TODAY` | (real date) | Pins today's date, for demonstrations. |
| `TRUST_PROXY` | off | Set to `1` when running behind a reverse proxy that terminates HTTPS. |

With no sample data there are no accounts, so create the first super admin before starting:

```bash
SEED=0 npm start   # once, to create the empty database, then stop it
node --no-warnings -e "
import('./server/db.js').then(async ({ Store }) => {
  const { hashPassword } = await import('./server/auth.js');
  const s = new Store('data/academy.db');
  s.tx(() => s.put('users', { id: 'u-admin', username: 'admin', name: 'Administrator', role: 'super', password: hashPassword(process.argv[1]) }));
});" 'choose-a-strong-password'
```

### Docker

```bash
docker build -t almuntazar-academy .
docker run -p 3000:3000 -v academy-data:/app/data almuntazar-academy
```

## How it is built

```
server/
  index.js      HTTP server: sign-in, data, actions, uploads, and the web app
  db.js         SQLite store: one table of JSON records per collection
  auth.js       scrypt password hashing and cookie sessions
  access.js     who may see what (teacher material access, training invitations)
  snapshot.js   the records each role receives; question answers never go to students
  actions.js    every change the app can make, each with a role check and validation
  seed.js       the sample data from the prototype
public/
  index.html, css/app.css
  js/app.js     sign-in, navigation, rendering, buttons and forms
  js/logic.js   values worked out from the records: attendance status, metrics, reading
  js/views/     one file per role, plus shared screens and dialogs
shared/         date helpers and exam marking used by both server and browser
test/           server tests
```

- **Sign-in:** usernames and passwords, hashed with scrypt. Sessions are HTTP-only cookies kept for 30 days. Repeated failed sign-ins are slowed down.
- **Permissions:** every action names the roles that may use it and checks that the class, session or record belongs to the caller's location, classes or teaching load.
- **Data each person sees:** students get only their own class, their own attendance and their own published marks, unless they are the class assistant. Location staff get only their location. Question answers stay on the server.
- **Exams:** starting an exam creates an attempt on the server and sends the questions without answers, with match columns shuffled. The answers are marked on the server. Each exam can be taken once, and marks stay hidden until the location publishes them.
- **Sessions:** a session record is created automatically for each scheduled class date once it has passed, so it can be logged. Week numbers are worked out again when a session is cancelled.
- **Attendance status:** this works as in the prototype. Two absences in a row is *At risk*, four is *In follow-up*, and students who joined in the last 14 days are *New*.

## Not built yet

These parts of the prototype are placeholders that need outside services or content:

- **Sending email and WhatsApp.** Reminders, published results and training invitations are written to an `outbox` table. Connecting an email and WhatsApp provider to send them is the next step.
- **Reading uploaded question papers.** *Import a question paper* reviews and imports the sample paper (`server/data/sample-paper.json`, read from `Tauheed_1_MCQ_paper_-_new.docx`). It does not yet read the yellow-highlighted answers from a newly uploaded Word file.
- **Loading the syllabus chart from Excel.** The chart shows placeholder topics until the academy's Excel template is available. *Mark chart as loaded* switches on the placeholders for a semester.
- **Moving a class to its next semester**, and re-exams after a fail.
- **Recording who attended a training session.**
- **The Dean's signature on certificates.** Certificates can be printed or saved as PDF from the browser.
