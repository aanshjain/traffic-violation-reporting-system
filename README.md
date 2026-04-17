🚦 Traffic Violation Reporting System (TVRS)

A full-stack prototype system for reporting, tracking, and managing traffic violations through a centralized workflow.
This project demonstrates backend server design, structured system architecture using UML diagrams, and requirement-engineering practices.

Developed as part of a software engineering semester project at Jaypee University of Information Technology (JUIT), Waknaghat.

📋 Table of Contents
Project Overview
System Features
Technology Stack
Project Structure
System Architecture (UML)
How to Run Locally
Learning Outcomes
Future Improvements
Authors
📘 Project Overview

The Traffic Violation Reporting System (TVRS) is designed to simplify the process of reporting and managing road-traffic violations.

The system allows:

Citizens to report violations
Authorities to verify reports
Administrators to manage enforcement workflows

It demonstrates how requirement engineering, backend development, and UML modeling combine to create structured real-world software systems.

⚙️ System Features
Traffic violation reporting interface
Backend server using Node.js
Local database storage (SQLite)
Upload support for violation evidence
Structured UML system design
Requirement documentation (SRS included)
🧰 Technology Stack

Backend:

Node.js
Express.js

Database:

SQLite (database.db)

Frontend:

HTML / CSS (served via public directory)

Software Engineering Tools:

UML Diagrams
SRS Documentation
📂 Project Structure
traffic-violation-reporting-system
│
├── server.js
├── package.json
├── database.db
│
├── public/
│
├── uploads/
│
├── docs/
│   ├── SRS.pdf
│   ├── activity-diagram.png
│   ├── class-diagram.png
│   ├── collaboration-diagram.png
│   └── component-diagram.png
│
└── README.md
🧩 System Architecture (UML)

This project includes the following diagrams:

Activity Diagram → workflow of violation reporting
Class Diagram → system object relationships
Collaboration Diagram → interaction between modules
Component Diagram → high-level architecture layout

These help visualize both logical structure and runtime interaction of the system.

▶️ How to Run Locally

Clone the repository:

git clone https://github.com/aanshjain/traffic-violation-reporting-system.git
cd traffic-violation-reporting-system

Install dependencies:

npm install

Start the server:

node server.js

Open browser:

http://localhost:3000
🎓 Learning Outcomes

This project strengthened understanding of:

Software Engineering

Requirement specification (SRS)
UML-based architecture planning
Component-level system thinking

Backend Development

Node.js server configuration
Express routing
SQLite database handling
File upload workflow

Project Structuring

Documentation-driven development
Modular folder organization
Real-world workflow modeling
🚀 Future Improvements

Possible extensions include:

Authentication system (admin / authority login)
Cloud database integration
Deployment on Render / Railway
Real-time violation tracking dashboard
API-based mobile integration support

👨‍💻 Authors
Name	Roll Number
Aansh Jain	241030210

Department: Computer Science & Engineering & IT
Institution: Jaypee University of Information Technology, Waknaghat

📄 Documentation Included
This repository contains:

Software Requirement Specification (SRS)
UML architecture diagrams
Backend prototype implementation

Together they represent the complete lifecycle from requirement analysis → system design → implementation prototype
