
function isEditorOrAdmin(diseasePage, userId, userRole) {
  return (
    diseasePage?.editors?.includes(userId) ||
    userRole === 'admin-user' ||
    userRole === 'moderator-user'
  );
}

module.exports = {
  isEditorOrAdmin,
};
