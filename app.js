// Mock Data
let employees = [
    { id: 1, employeeId: "EMP-001", name: "Sarah Jenkins", role: "Senior Developer", email: "sarah.j@nexis.com", doj: "2022-03-15", currentProject: "Alpha Redesign", team: "Engineering", certificates: ["React_Summit_2023.pdf"], avatar: "https://ui-avatars.com/api/?name=Sarah+Jenkins&background=8b5cf6&color=fff" },
    { id: 2, employeeId: "EMP-002", name: "Marcus Chen", role: "UI/UX Designer", email: "marcus.c@nexis.com", doj: "2023-01-10", currentProject: "Nexus Mobile", team: "Design", certificates: [], avatar: "https://ui-avatars.com/api/?name=Marcus+Chen&background=ec4899&color=fff" },
    { id: 3, employeeId: "EMP-003", name: "Emily Watson", role: "Product Manager", email: "emily.w@nexis.com", doj: "2021-11-05", currentProject: "Q4 Roadmap", team: "Product", certificates: ["Agile_Leadership.pdf", "Scrum_Master.pdf"], avatar: "https://ui-avatars.com/api/?name=Emily+Watson&background=10b981&color=fff" },
    { id: 4, employeeId: "EMP-004", name: "David Kim", role: "DevOps Engineer", email: "david.k@nexis.com", doj: "2022-08-20", currentProject: "Cloud Migration", team: "Infrastructure", certificates: [], avatar: "https://ui-avatars.com/api/?name=David+Kim&background=f59e0b&color=fff" }
];

const achievements = [
    { id: 1, user: "Sarah Jenkins", title: "Code Quality Award", desc: "Maintained 0 bugs in Q3", icon: "award" },
    { id: 2, user: "Marcus Chen", title: "Design Excellence", desc: "New app redesign shipped", icon: "palette" },
    { id: 3, user: "Team Alpha", title: "Sprint Goal Met", desc: "Delivered project ahead of time", icon: "zap" }
];

// View Switching Logic
function switchView(viewName) {
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`btn-${viewName}-view`).classList.add('active');

    document.querySelectorAll('.view-section').forEach(section => section.style.display = 'none');
    const targetSection = document.getElementById(`${viewName}-view`);
    targetSection.style.display = 'block';
    
    targetSection.style.animation = 'none';
    targetSection.offsetHeight; 
    targetSection.style.animation = null;

    const roleDisplay = document.getElementById('current-role-display');
    roleDisplay.textContent = viewName === 'manager' ? 'Manager' : 'Employee Space';
}

// Render Manager Directory
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
            <td>${emp.employeeId}</td>
            <td>${emp.role}</td>
            <td>${emp.doj}</td>
            <td><span class="status-badge status-active">${emp.currentProject}</span></td>
            <td>${emp.team}</td>
        </tr>
    `).join('');
}

function renderAchievements() {
    const list = document.getElementById('achievement-list');
    if (!list) return;
    list.innerHTML = achievements.map(ach => `
        <div class="achievement-item">
            <div class="ach-icon"><i data-lucide="${ach.icon}"></i></div>
            <div class="ach-content">
                <h4>${ach.title}</h4>
                <p><strong>${ach.user}</strong> - ${ach.desc}</p>
            </div>
        </div>
    `).join('');
}

// Render Employee Space Cards
function renderEmployeeSpace() {
    const container = document.getElementById('employee-cards-container');
    if (!container) return;

    container.innerHTML = employees.map(emp => `
        <div class="emp-card glass-panel">
            <div class="emp-card-header">
                <img src="${emp.avatar}" alt="${emp.name}" class="emp-card-avatar">
                <div class="emp-card-info">
                    <h3>${emp.name}</h3>
                    <p>${emp.role}</p>
                    <span class="emp-id-badge">${emp.employeeId}</span>
                </div>
            </div>
            
            <div class="emp-card-actions">
                <button class="btn-outline" onclick="triggerUpload(${emp.id})">
                    <i data-lucide="upload-cloud"></i> Upload Cert
                </button>
                <button class="btn-primary" onclick="toggleCerts(${emp.id})">
                    <i data-lucide="eye"></i> View Certs
                </button>
            </div>
            
            <div class="cert-viewer" id="certs-${emp.id}" style="display: none;">
                <h4>Conference Certificates</h4>
                ${emp.certificates.length > 0 
                    ? `<ul class="cert-list">
                        ${emp.certificates.map(cert => `
                            <li><i data-lucide="file-text"></i> ${cert}</li>
                        `).join('')}
                       </ul>`
                    : `<p class="no-certs">No certificates uploaded yet.</p>`
                }
            </div>
        </div>
    `).join('');
    
    lucide.createIcons();
}

// Certificate Logic
function triggerUpload(empId) {
    const fileName = prompt("Enter the name of the certificate file to upload (e.g., 'React_Summit.pdf'):");
    if (fileName && fileName.trim() !== "") {
        const emp = employees.find(e => e.id === empId);
        if (emp) {
            emp.certificates.push(fileName.trim());
            alert(`${fileName} uploaded successfully for ${emp.name}!`);
            renderEmployeeSpace();
            const certViewer = document.getElementById(`certs-${empId}`);
            if(certViewer) certViewer.style.display = 'block';
        }
    }
}

function toggleCerts(empId) {
    const certViewer = document.getElementById(`certs-${empId}`);
    if (certViewer) {
        certViewer.style.display = certViewer.style.display === 'none' ? 'block' : 'none';
    }
}

// Add New Employee Logic
function openAddEmployeeModal() {
    document.getElementById('add-employee-modal').style.display = 'flex';
}

function closeAddEmployeeModal() {
    document.getElementById('add-employee-modal').style.display = 'none';
    document.getElementById('add-emp-form').reset();
}

function handleAddEmployee(event) {
    event.preventDefault();
    const name = document.getElementById('emp-name').value;
    const email = document.getElementById('emp-email').value;
    const employeeId = document.getElementById('emp-id').value;
    const role = document.getElementById('emp-role').value;
    const doj = document.getElementById('emp-doj').value;
    const project = document.getElementById('emp-project').value;
    const team = document.getElementById('emp-team').value;

    const newEmp = {
        id: employees.length + 1,
        employeeId: employeeId,
        name: name,
        role: role,
        email: email,
        doj: doj,
        currentProject: project,
        team: team,
        certificates: [],
        avatar: \`https://ui-avatars.com/api/?name=\${encodeURIComponent(name)}&background=random&color=fff\`
    };

    employees.push(newEmp);
    closeAddEmployeeModal();
    
    renderEmployees();
    renderEmployeeSpace();
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    renderEmployees();
    renderAchievements();
    renderEmployeeSpace();
    lucide.createIcons();
    
    const addForm = document.getElementById('add-emp-form');
    if(addForm) {
        addForm.addEventListener('submit', handleAddEmployee);
    }
});
