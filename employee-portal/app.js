// Mock Data
const employees = [
    { id: 1, name: "Sarah Jenkins", role: "Senior Developer", email: "sarah.j@nexis.com", status: "active", progress: 85, avatar: "https://ui-avatars.com/api/?name=Sarah+Jenkins&background=8b5cf6&color=fff" },
    { id: 2, name: "Marcus Chen", role: "UI/UX Designer", email: "marcus.c@nexis.com", status: "busy", progress: 60, avatar: "https://ui-avatars.com/api/?name=Marcus+Chen&background=ec4899&color=fff" },
    { id: 3, name: "Emily Watson", role: "Product Manager", email: "emily.w@nexis.com", status: "active", progress: 92, avatar: "https://ui-avatars.com/api/?name=Emily+Watson&background=10b981&color=fff" },
    { id: 4, name: "David Kim", role: "DevOps Engineer", email: "david.k@nexis.com", status: "active", progress: 45, avatar: "https://ui-avatars.com/api/?name=David+Kim&background=f59e0b&color=fff" }
];

const achievements = [
    { id: 1, user: "Sarah Jenkins", title: "Code Quality Award", desc: "Maintained 0 bugs in Q3", icon: "award" },
    { id: 2, user: "Marcus Chen", title: "Design Excellence", desc: "New app redesign shipped", icon: "palette" },
    { id: 3, user: "Team Alpha", title: "Sprint Goal Met", desc: "Delivered project ahead of time", icon: "zap" }
];

const files = [
    { id: 1, name: "Project Guidelines", type: "folder", date: "Oct 12" },
    { id: 2, name: "Assets & Logos", type: "folder", date: "Oct 10" },
    { id: 3, name: "Q3_Report.pdf", type: "file", date: "Oct 24", icon: "file-text" },
    { id: 4, name: "API_Docs.md", type: "file", date: "Oct 22", icon: "file-code" },
    { id: 5, name: "User_Research.xlsx", type: "file", date: "Oct 20", icon: "file-spreadsheet" }
];

const tasks = [
    { id: 1, text: "Review Q4 roadmap with stakeholders", tag: "Management", completed: false },
    { id: 2, text: "Update design system components", tag: "Design", completed: true },
    { id: 3, text: "Prepare presentation for all-hands", tag: "General", completed: false },
    { id: 4, text: "Approve pending pull requests", tag: "Dev", completed: false }
];

// View Switching Logic
function switchView(viewName) {
    // Update nav buttons
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.remove('active');
    });
    document.getElementById(`btn-${viewName}-view`).classList.add('active');

    // Update visibility
    document.querySelectorAll('.view-section').forEach(section => {
        section.style.display = 'none';
    });
    
    const targetSection = document.getElementById(`${viewName}-view`);
    targetSection.style.display = 'block';
    
    // Re-trigger animation
    targetSection.style.animation = 'none';
    targetSection.offsetHeight; // Trigger reflow
    targetSection.style.animation = null;

    // Update user role display
    const roleDisplay = document.getElementById('current-role-display');
    roleDisplay.textContent = viewName === 'manager' ? 'Manager' : 'Employee';
}

// Render Functions
function renderEmployees() {
    const tbody = document.getElementById('employee-table-body');
    if (!tbody) return;
    
    tbody.innerHTML = employees.map(emp => `
        <tr>
            <td>
                <div class="emp-cell">
                    <img src="${emp.avatar}" alt="${emp.name}" class="emp-avatar">
                    <div>
                        <div class="emp-name">${emp.name}</div>
                        <div class="emp-email">${emp.email}</div>
                    </div>
                </div>
            </td>
            <td>${emp.role}</td>
            <td><span class="status-badge status-${emp.status}">${emp.status.charAt(0).toUpperCase() + emp.status.slice(1)}</span></td>
            <td>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <div class="progress-bar-bg">
                        <div class="progress-fill" style="width: ${emp.progress}%; background: ${getProgressColor(emp.progress)}"></div>
                    </div>
                    <span style="font-size: 0.75rem; color: var(--text-muted);">${emp.progress}%</span>
                </div>
            </td>
            <td>
                <button class="btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">View</button>
            </td>
        </tr>
    `).join('');
}

function getProgressColor(val) {
    if (val >= 80) return 'var(--success)';
    if (val >= 50) return 'var(--primary)';
    return 'var(--warning)';
}

function renderAchievements() {
    const list = document.getElementById('achievement-list');
    if (!list) return;

    list.innerHTML = achievements.map(ach => `
        <div class="achievement-item">
            <div class="ach-icon">
                <i data-lucide="${ach.icon}"></i>
            </div>
            <div class="ach-content">
                <h4>${ach.title}</h4>
                <p><strong>${ach.user}</strong> - ${ach.desc}</p>
            </div>
        </div>
    `).join('');
}

function renderFiles() {
    const grid = document.getElementById('file-grid');
    if (!grid) return;

    grid.innerHTML = files.map(file => {
        const isFolder = file.type === 'folder';
        const iconName = isFolder ? 'folder' : (file.icon || 'file');
        
        return `
            <div class="file-card ${isFolder ? 'folder' : ''}">
                <div class="file-icon">
                    <i data-lucide="${iconName}" style="width: 32px; height: 32px;"></i>
                </div>
                <div class="file-name" title="${file.name}">${file.name}</div>
                <div class="file-date">${file.date}</div>
            </div>
        `;
    }).join('');
}

function renderTasks() {
    const list = document.getElementById('personal-task-list');
    if (!list) return;

    list.innerHTML = tasks.map(task => `
        <li class="task-item ${task.completed ? 'completed' : ''}">
            <div class="task-checkbox" onclick="toggleTask(${task.id})">
                ${task.completed ? '<i data-lucide="check" style="width: 14px; height: 14px; color: white;"></i>' : ''}
            </div>
            <span class="task-text">${task.text}</span>
            <span class="task-tag">${task.tag}</span>
        </li>
    `).join('');
}

function toggleTask(id) {
    const task = tasks.find(t => t.id === id);
    if (task) {
        task.completed = !task.completed;
        renderTasks();
        lucide.createIcons(); // Re-initialize icons for the new checkmarks
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    renderEmployees();
    renderAchievements();
    renderFiles();
    renderTasks();
    lucide.createIcons();
});
